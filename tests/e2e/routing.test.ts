/**
 * Intégration 1.1 entre équipes : le calcul de trajets (équipe routage, développé sur les fixtures du cœur produites par
 * app/test/core/support/gen-fixtures.ts) sur les fichiers que produit vraiment le pipeline (zips de
 * fixtures/pipeline/gtfs, npm run build-data), servis par serve-data, avec le vrai relais (npm run dev) branché sur le
 * faux portail BMC. Vrai cœur (createCore), réglages fixtures/app/preset-1.1.json migrés en v3 par app/src/settings.ts,
 * comme l'appli les lit (1.2 : lieux fondus dans les favoris).
 * Oracle : fixtures/README.md (« Extension 1.1 »), PRD 1.1 § 5 (CA-M1 à CA-M8), docs/v1.2/PRD-1.2.md § 1 et § 5
 * (CA-1.2 à CA-1.6, CA-2.1, CA-2.2), docs/v1.1/DECISIONS.md § 7 et § 8 ; classement : docs/v1.2.2/PRD-1.2.2.md § 7 (le
 * premier arrive le plus tôt, chaque minute de marche au-delà de la marche maximale compte triple).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AreaFile, TileFile, TrainsDay } from '../../shared/types';
import { createCore } from '../../app/src/core/index';
import type { Core, Departure, Endpoint, Favorite, FavoriteAnswer, Journey, Leg, PlanResult, Settings } from '../../app/src/core/api';
import { favoriteTitle } from '../../app/src/core/favorites';
import { displayLabel, longestWalk } from '../../app/src/core/means';
import { itemOf } from '../../app/src/core/routing/rank';
import { hhmm, lineLabel, minutesUntil } from '../../app/src/core/util';
import { migrateSettings } from '../../app/src/settings';
import { textWidth } from '../../app/src/glasses/font';
import { buildFeeds, feedZip, loadNetwork } from '../../fixtures/pipeline/make-gtfs';
import { validateData } from './validate-data';
import { buildFixtureData, GTFS, memoryKV, ROOT, startDataServer, startStack, type Proc, type Stack } from './lib/stack';

const readPreset = (name: string) => JSON.parse(readFileSync(join(ROOT, 'fixtures', 'app', name), 'utf8')) as Record<string, unknown>;
/**
 * Réglages v4 (1.2.2) : le préréglage 1.1 migré, comme l'appli le lit au premier lancement après la mise à jour ; ses
 * arrêts favoris sont rangés dans les gares et les lignes (PRD-1.2.2 § 5).
 */
const PRESET: Settings = migrateSettings(readPreset('preset-1.1.json'));
/** Les mêmes réglages lus comme en 1.2.1, arrêts favoris compris, à leur place : le cœur répond toujours à un arrêt favori. */
const legacy = (raw: Record<string, unknown>, s: Settings): Settings => {
  const old = raw.favorites as { id: string; kind: string }[];
  return {
    ...s,
    favorites: [
      ...old.map((r) => s.favorites.find((f) => f.id === r.id) ?? (r.kind === 'stop' ? (r as unknown as Favorite) : undefined)).filter((f): f is Favorite => f !== undefined),
      ...s.favorites.filter((f) => !old.some((r) => r.id === f.id)),
    ],
  };
};
const LEGACY = legacy(readPreset('preset-1.1.json'), PRESET);
const APP_FIXTURES = join(ROOT, 'app', 'test', 'fixtures', 'core', 'data');
const T = (hm: string, day = '2026-11-10') => Date.parse(`${day}T${hm}:00+01:00`);
const S1 = { lat: 50.4655, lon: 4.859 };
const S2 = { lat: 50.86, lon: 4.359 };
const S3 = { lat: 50.8454, lon: 4.3571 };
const BUREAU = { lat: 50.8441, lon: 4.3474 };
const here: Endpoint = { type: 'here' };
// 1.2 : un lieu est un favori lieu ; le lieu « Bureau » a fusionné avec « Vers le bureau » (CA-2.1)
const bureau: Endpoint = { type: 'place', placeId: 'fav-bureau' };
const maison: Endpoint = { type: 'place', placeId: 'fav-maison' };
const addr = (label: string, lat: number, lon: number): Endpoint => ({ type: 'address', label, lat, lon });
const RUE_NEUVE = addr('Rue Neuve 1, 1000 Bruxelles', 50.8505, 4.3545);
const CENTENAIRE = addr('Boulevard du Centenaire 1, 1020 Bruxelles', 50.8915, 4.334);
const UCCLE = addr('Avenue Winston Churchill 100, 1180 Uccle', 50.808, 4.365);
const VELDSTRAAT = addr('Veldstraat 1, 9000 Gent', 51.0537, 3.7225);
const WATERLOO = addr('Chaussée de Bruxelles 1, 1410 Waterloo', 50.7175, 4.399);
const PROGRES = addr('Rue du Progrès 20, 1210 Saint-Josse-ten-Noode', 50.8582, 4.36);
const BASTOGNE = addr('Rue du Bois 1, 6600 Bastogne', 50.003, 5.715);
const KORENMARKT: Endpoint = { type: 'area', areaId: 'delijn:200101', op: 'delijn', name: { fr: 'Korenmarkt, Gand', nl: 'Gent Korenmarkt' }, lat: 51.05472, lon: 3.72145 };
const CENTRAL: Endpoint = { type: 'area', areaId: 'sncb:8813003', op: 'sncb', name: { fr: 'Bruxelles-Central', nl: 'Brussel-Centraal' }, lat: 50.8454, lon: 4.3571 };
const MEISE: Endpoint = { type: 'area', areaId: 'delijn:300450', op: 'delijn', name: { fr: 'Meise Centrum', nl: 'Meise Centrum' }, lat: 50.939, lon: 4.327 };

/** Texte attendu avec la typographie 1.1 (DECISIONS § 6) : espace insécable devant « : » et entre un nombre et son unité. */
const fr = (s: string) => s.replace(/ :/g, '\u00a0:').replace(/(\d) (min|h)\b/g, '$1\u00a0$2');
const times = (j: Journey) => `${hhmm(j.dep)} → ${hhmm(j.arr)}`;
const labels = (r: PlanResult) => r.journeys.map((j) => j.label);
const rides = (j: Journey) => j.legs.filter((l): l is Leg & { kind: 'ride' } => l.kind === 'ride');
/** Étapes lisibles, comme app/test/core/routing/support.ts : « marche 7 | 07:42 IC Namur → Bruxelles-Central 08:46 | marche 12 ». */
const legsOf = (j: Journey) =>
  j.legs.map((l) => (l.kind === 'walk' ? `marche ${l.walkMin}` : `${hhmm(l.dep)} ${l.cat ?? lineLabel(l.mode ?? 'bus', l.line ?? '')} ${l.from.name.fr} → ${l.to.name.fr} ${hhmm(l.arr)}`)).join(' | ');
const depText = (d: Departure, now: number) => `${lineLabel(d.mode, d.line)} ${d.head.fr} ${d.rt ? '' : '~'}${minutesUntil(d.est, now)}\u00a0min`;

/** Texte affiché : pas de tiret long ni demi-cadratin, typographie 1.1 (pas d'espace ordinaire devant « : » ni avant une unité). */
function typography(t: string | undefined): void {
  if (t === undefined) return;
  expect(t, `tiret dans « ${t} »`).not.toMatch(/[\u2013\u2014]/);
  expect(t, `espace ordinaire devant une ponctuation haute dans « ${t} »`).not.toMatch(/ [:;!?]/);
  expect(t, `espace ordinaire avant une unité dans « ${t} »`).not.toMatch(/\d (min|h)\b/);
}

/** Plus longue marche au-delà de la marche maximale (PRD-1.2.2 § 7 : chaque minute compte triple). */
const over = (j: Journey, maxWalk = PRESET.maxWalkMin) => Math.max(0, longestWalk(j) - maxWalk);

/**
 * Invariants de toute réponse (CA-M3.1) : 3 propositions au plus, sans doublon, aucun véhicule supprimé ; étiquette et
 * raison sur une ligne des lunettes (542 px mesurés avec la police des lunettes, 60 caractères au plus) ; étapes dans
 * l'ordre du temps, de la position de départ à l'arrivée.
 * 1.2.2 (PRD-1.2.2 § 7) : la proposition 1 (`short`) en tête ; « Plus tôt » arrive au moins 5 min avant elle (la marche
 * seule n'est jamais proposée autrement) ; « Moins de marche » seulement si elle dépasse la marche maximale, au plus
 * 20 min après, dans la marche maximale ou 5 min de moins ; « Sans changement », « Moins de changements » : moins de
 * changements, au plus 15 min après, jamais plus de marche au-delà de la marche maximale ; « Le suivant » et « Plus
 * tard » partent et arrivent après la proposition 1 et les « Le suivant » d'avant ; aucune proposition dominée par une
 * autre (départ, arrivée, plus longue marche, changements). Raisons : « {nom affiché} : … » (displayLabel),
 * « Plus tôt de 13 min, … ».
 */
function check(r: PlanResult, maxWalk = PRESET.maxWalkMin): PlanResult {
  expect(r.journeys.length).toBeLessThanOrEqual(3);
  if (r.journeys.length) {
    const short = r.journeys[0];
    const MIN = 60_000;
    expect(short.label).toBe('short');
    expect(r.journeys.filter((j) => j.label === 'short')).toHaveLength(1);
    const seq = [itemOf(short)];
    for (const j of r.journeys.slice(1)) {
      const x = itemOf(j);
      if (!rides(j).length) expect(j.label, 'marche seule : proposition 1 ou « Plus tôt »').toBe('earlier');
      if (j.label === 'earlier') expect(j.arr).toBeLessThanOrEqual(short.arr - 5 * MIN);
      if (j.label === 'lesswalk') {
        expect(over(short, maxWalk)).toBeGreaterThan(0);
        expect(j.arr).toBeLessThanOrEqual(short.arr + 20 * MIN);
        expect(longestWalk(j) <= maxWalk || longestWalk(j) <= longestWalk(short) - 5).toBe(true);
      }
      if (j.label === 'none' || j.label === 'fewer') {
        expect(j.transfers).toBeLessThan(short.transfers);
        expect(j.arr).toBeLessThanOrEqual(short.arr + 15 * MIN);
        expect(over(j, maxWalk)).toBeLessThanOrEqual(over(short, maxWalk));
      }
      if (j.label === 'next' || j.label === 'later') {
        for (const s of seq) {
          expect(x.dep, `${j.label} part après`).toBeGreaterThan(s.dep);
          expect(x.arr, `${j.label} arrive après`).toBeGreaterThan(s.arr);
        }
        seq.push(x);
      }
    }
    for (const a of r.journeys)
      for (const b of r.journeys) {
        if (a === b) continue;
        const [x, y] = [itemOf(a), itemOf(b)];
        const [lx, ly] = [longestWalk(a), longestWalk(b)];
        expect(x.dep >= y.dep && x.arr <= y.arr && lx <= ly && x.transfers <= y.transfers && (x.dep > y.dep || x.arr < y.arr || lx < ly || x.transfers < y.transfers), `${a.label} domine ${b.label}`).toBe(false);
      }
  }
  expect(new Set(r.journeys.map((j) => j.id)).size).toBe(r.journeys.length);
  for (const j of r.journeys) {
    expect(j.legs.some((l) => l.kind === 'ride' && l.cancelled)).toBe(false);
    expect(j.label, j.id).toBeTruthy();
    expect(j.reason?.startsWith(j.label === 'earlier' ? 'Plus tôt de ' : `${displayLabel(j, r.journeys)}\u00a0: `), j.reason).toBe(true);
    typography(j.reason);
    expect(textWidth(j.reason ?? ''), `« ${j.reason} » plus large qu’une ligne des lunettes`).toBeLessThanOrEqual(542);
    expect((j.reason ?? '').length).toBeLessThanOrEqual(60);
    for (const a of j.alerts) typography(a.text);
    expect(j.transfers).toBe(Math.max(0, rides(j).length - 1));
    for (let i = 1; i < j.legs.length; i++) expect(j.legs[i].dep, `${legsOf(j)} : étape ${i} avant la précédente`).toBeGreaterThanOrEqual(j.legs[i - 1].arr - 60_000);
    expect(j.arr).toBe(j.legs[j.legs.length - 1].arr);
  }
  return r;
}

let stack: Stack;
const coreAt = (now: number): Core => createCore({ dataBase: stack.data.url, relayBase: stack.relay.url, now: () => now, storage: memoryKV(), fetch });
const route = (now: number, from: Endpoint, to: Endpoint, pos?: { lat: number; lon: number } | null) => coreAt(now).route(from, to, now, PRESET, pos).then(check);

beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  await stack?.stop();
});

/* ------------------------------ données : pipeline et fixtures du cœur ------------------------------ */

const listJson = (dir: string, sub: string): string[] =>
  readdirSync(join(dir, sub))
    .flatMap((n) => (statSync(join(dir, sub, n)).isDirectory() ? listJson(dir, `${sub}/${n}`) : n.endsWith('.json') ? [`${sub}/${n}`] : []))
    .sort();
const readJ = <X>(dir: string, rel: string): X => JSON.parse(readFileSync(join(dir, rel), 'utf8')) as X;

/** Égalité profonde, nombres à `tol` près ; renvoie les écarts lisibles. */
function deepDiff(a: unknown, b: unknown, tol: number, path = '', out: string[] = []): string[] {
  if (out.length > 10) return out;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > tol) out.push(`${path} : pipeline ${a}, gen-fixtures ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path} : ${a.length} éléments, gen-fixtures ${b.length}`);
    else a.forEach((x, i) => deepDiff(x, b[i], tol, `${path}[${i}]`, out));
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) out.push(`${path} : clés ${ka.join()} ≠ ${kb.join()}`);
    for (const k of ka) if (k in (b as object)) deepDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tol, `${path}.${k}`, out);
  } else if (a !== b) out.push(`${path} : pipeline ${JSON.stringify(a)}, gen-fixtures ${JSON.stringify(b)}`);
  return out;
}

describe('données : le pipeline produit ce que le routage attend (gen-fixtures.ts du cœur)', () => {
  it('fichiers de ligne, index et tuiles de lignes identiques, au 1/100 000 de degré près', () => {
    const files = [...listJson(stack.dataDir, 'lines'), ...listJson(stack.dataDir, 'linetiles')].sort();
    expect(files).toEqual([...listJson(APP_FIXTURES, 'lines'), ...listJson(APP_FIXTURES, 'linetiles')].sort());
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const a = readJ<Record<string, unknown>>(stack.dataDir, f);
      const b = readJ<Record<string, unknown>>(APP_FIXTURES, f);
      if (f === 'lines/index.json') {
        // date de génération : celle de la nuit, égale à meta.generatedAt (data.test.ts)
        delete a.generatedAt;
        delete b.generatedAt;
        // 1.2.6 : couleurs des lignes (5e et 6e éléments), lues dans les horaires ; gen-fixtures n'en a pas
        if (Array.isArray(a.lines)) a.lines = (a.lines as unknown[][]).map((e) => e.slice(0, 4));
      } else if (f.startsWith('lines/')) {
        delete a.color;
        delete a.text;
      }
      // seul écart connu : Gare du Midi (STIB) arrondie à 50.83567 (pipeline) contre 50.83568 (gen-fixtures)
      expect(deepDiff(a, b, 1.1e-5), f).toEqual([]);
    }
  });

  it('trains et zones : même réseau, à l’ordre près ; tuiles : sans les zones qui n’ont aucun départ (S5)', () => {
    for (const date of ['2026-11-10', '2026-11-11']) {
      const norm = (t: TrainsDay) => ({
        stations: Object.fromEntries(t.stations.map((s) => [s.id, [s.n.fr, s.n.nl, s.lat.toFixed(4), s.lon.toFixed(4)]])),
        trips: Object.fromEntries(t.trips.map((x) => [x.id, { ...x, s: x.s.map((p) => [t.stations[p[0]].id, p[1], p[2], p[3], p[4]]) }])),
      });
      const p = norm(readJ<TrainsDay>(stack.dataDir, `trains/${date}.json`));
      const a = norm(readJ<TrainsDay>(APP_FIXTURES, `trains/${date}.json`));
      expect(Object.keys(p.trips).sort(), date).toEqual(Object.keys(a.trips).sort());
      expect(deepDiff(p, a, 0), date).toEqual([]);
    }
    const areaFiles = listJson(stack.dataDir, 'areas');
    expect(areaFiles).toEqual(listJson(APP_FIXTURES, 'areas'));
    for (const f of areaFiles) {
      const norm = (x: AreaFile) => {
        const pk = (i: number) => JSON.stringify([x.patterns[i].line, x.patterns[i].mode, x.patterns[i].route, x.patterns[i].head, x.patterns[i].next]);
        return {
          n: x.n,
          stops: [...x.stops].sort((u, v) => (u.id < v.id ? -1 : 1)),
          patterns: x.patterns.map((_, i) => pk(i)).sort(),
          deps: x.deps.map((d) => JSON.stringify([d[0], d[1], pk(d[2]), x.stops[d[3]].id, d[4], d[5]])).sort(),
        };
      };
      const p = readJ<AreaFile>(stack.dataDir, f);
      const a = readJ<AreaFile>(APP_FIXTURES, f);
      expect(deepDiff(norm(p), norm(a), 0), f).toEqual([]);
      expect(Math.abs(p.lat - a.lat) + Math.abs(p.lon - a.lon), f).toBeLessThan(2e-5);
    }
    // gen-fixtures publie aussi les zones sans départ (terminus) ; le pipeline 1.1 les retire des tuiles (S5)
    const tiles = (dir: string) => new Map(listJson(dir, 'tiles').flatMap((f) => readJ<TileFile>(dir, f).areas.map((x) => [x.id, x] as const)));
    const p = tiles(stack.dataDir);
    const a = tiles(APP_FIXTURES);
    expect([...a.keys()].filter((id) => !p.has(id)).sort()).toEqual(
      ['delijn:300120', 'delijn:300450', 'delijn:301870', 'sncb:8821006', 'sncb:8891009', 'stib:6370', 'stib:8302', 'tec:N520aaa', 'tec:N530aaa', 'tec:N540aaa'].sort(),
    );
    for (const [id, x] of p) {
      expect(a.has(id), id).toBe(true);
      // même zone ; les lignes du pipeline sont rangées par mode (« 2 6 3 4 » à Rogier), celles de gen-fixtures par numéro
      expect(deepDiff({ ...x, lines: [...x.lines].sort() }, { ...a.get(id), lines: [...a.get(id)!.lines].sort() }, 2e-5), id).toEqual([]);
    }
  });
});

/* ------------------------------ route() sur les données du pipeline ------------------------------ */

describe('route() : CA-M2, CA-M3, CA-M5 sur les données du pipeline', () => {
  it('CA-M2.2, CA-1.3, scène noRT (1.2.2) : Maison → Bureau à 07:31, IC puis T3 ; le direct et ses 12 min à pied jamais « Sans changement » ; « Le suivant »', async () => {
    await stack.scene('noRT');
    const r = await route(T('07:31'), here, bureau, S1);
    // 1.2.2 (PRD-1.2.2 § 7) : même IC, même arrivée ; le T3 depuis Bruxelles-Nord garde chaque marche dans les 10 min
    // réglées ; l'IC direct puis 12 min à pied marche plus au-delà de la marche maximale : jamais « Sans changement ».
    // « Le suivant » : l'IC 08:42 puis le T4 de 09:43 (09:57), qui domine l'IC 08:42 puis le T3 de 09:48 (10:02, § 7.4)
    expect(labels(r)).toEqual(['short', 'next']);
    expect(r.journeys.map(times)).toEqual(['07:33 → 08:58', '08:33 → 09:57']);
    expect(legsOf(r.journeys[0])).toBe('marche 7 | 07:42 IC Namur → Bruxelles-Nord 08:40 | marche 2 | 08:44 T3 Gare du Nord → Bourse 08:49 | marche 9');
    expect(legsOf(r.journeys[1])).toBe('marche 7 | 08:42 IC Namur → Bruxelles-Nord 09:40 | marche 2 | 09:43 T4 Gare du Nord → Bourse 09:48 | marche 9');
    expect(r.journeys.map((j) => j.reason)).toEqual([fr('Le plus court : 1 changement, à pied 7 + 2 + 9 min'), fr('Le suivant : 1 h plus tard')]);
    const [ic1, ic3] = r.journeys.map((j) => rides(j)[0]);
    expect([ic1.cat, ic1.head?.fr, ic1.platform, ic1.rt, ic1.from.areaId, ic1.to.areaId]).toEqual(['IC', 'Bruxelles-Midi', '4', false, 'sncb:8863008', 'sncb:8812005']);
    expect([hhmm(ic3.dep), ic3.platform]).toEqual(['08:42', '5']);
    expect(r.journeys.every((j) => !j.rt && j.alerts.every((x) => x.kind !== 'platform'))).toBe(true);
    // plan() de la 1.0 : les mêmes propositions, dans le même ordre
    expect((await coreAt(T('07:31')).plan(here, bureau, T('07:31'), PRESET, S1)).map((j) => j.id)).toEqual(r.journeys.map((j) => j.id));
  });

  it('CA-M2.1, scène base (1.2.2) : 07:35 → 08:58 par Bruxelles-Nord et le T3, IC +2 voie 6, alerte de voie en tête', async () => {
    await stack.scene('base');
    const r = await route(T('07:31'), here, bureau, S1);
    // l'IC a 2 min de retard, le T3 de 08:44 reste attrapable ; le direct (09:00, 2 min de marche de trop) n'est pas
    // proposé ; « Le suivant » : l'IC 08:42 puis le T4 (08:33 → 09:57), qui domine l'IC 08:42 puis le T3 (10:02)
    expect(labels(r)).toEqual(['short', 'next']);
    expect(r.journeys.map(times)).toEqual(['07:35 → 08:58', '08:33 → 09:57']);
    const ic = rides(r.journeys[0])[0];
    expect([hhmm(ic.schedDep), hhmm(ic.dep), ic.newPlatform, ic.delayMin, ic.rt, hhmm(ic.arr)]).toEqual(['07:42', '07:44', '6', 2, true, '08:42']);
    expect(r.journeys[0].alerts[0]?.text).toBe(fr('! Voie modifiée : l’IC part de la voie 6'));
    expect(hhmm(r.journeys[0].leaveAt)).toBe('07:35');
  });

  it('CA-1.4, CA-M5.1 : Maison → Rue Neuve 1 (noRT) : le plus court par Bruxelles-Nord et le T3 (08:51), puis le direct « Sans changement »', async () => {
    await stack.scene('noRT');
    const r = await route(T('07:31'), here, RUE_NEUVE, S1);
    expect(r.empty).toBeUndefined();
    expect(labels(r)).toEqual(['short', 'none', 'next']);
    // « Le suivant » : l'IC 08:42 puis le T4 de 09:43 (09:50), qui domine l'IC 08:42 puis le T3 de 09:48 (09:55)
    expect(r.journeys.map(times)).toEqual(['07:33 → 08:51', '07:33 → 08:56', '08:33 → 09:50']);
    expect(legsOf(r.journeys[0])).toBe('marche 7 | 07:42 IC Namur → Bruxelles-Nord 08:40 | marche 2 | 08:44 T3 Gare du Nord → De Brouckere 08:48 | marche 3');
    expect(legsOf(r.journeys[1])).toBe('marche 7 | 07:42 IC Namur → Bruxelles-Central 08:46 | marche 10');
    expect(legsOf(r.journeys[2])).toBe('marche 7 | 08:42 IC Namur → Bruxelles-Nord 09:40 | marche 2 | 09:43 T4 Gare du Nord → De Brouckere 09:47 | marche 3');
    expect(r.journeys.map((j) => j.reason)).toEqual([
      fr('Le plus court : 1 changement, à pied 7 + 2 + 3 min'),
      fr('Sans changement : à pied 7 + 10 min'),
      fr('Le suivant : 1 h plus tard'),
    ]);
    // C1 : le tram du fichier de ligne donne ses arrêts et l'arrêt physique pour le temps réel (pointid STIB)
    const t3 = rides(r.journeys[0])[1];
    expect([t3.op, t3.line, t3.fromStop, t3.toStop, t3.head?.fr]).toEqual(['stib', '3', '6357', '6361', 'Churchill']);
    expect(t3.stops?.map((s) => s.name.fr)).toEqual(['Gare du Nord', 'Rogier', 'De Brouckere']);
  });

  it('CA-1.4, scène base : l’IC a 2 min de retard, le classement reste le même sur les heures estimées (PRD § 4.5)', async () => {
    await stack.scene('base');
    const r = await route(T('07:31'), here, RUE_NEUVE, S1);
    expect(labels(r)).toEqual(['short', 'none', 'next']);
    expect(r.journeys.map(times)).toEqual(['07:35 → 08:51', '07:35 → 08:58', '08:33 → 09:50']);
    // correspondance tenue de justesse : Bruxelles-Nord 08:42, 2 min à pied, T3 08:44
    expect(legsOf(r.journeys[0])).toBe('marche 7 | 07:44 IC Namur → Bruxelles-Nord 08:42 | marche 2 | 08:44 T3 Gare du Nord → De Brouckere 08:48 | marche 3');
    expect(r.journeys[0].reason).toBe(fr('Le plus court : 1 changement, à pied 7 + 2 + 3 min'));
  });

  it('CA-1.5, CA-M5.5 (1.2.2) : scénario 4 de Waterloo (cas H) : bus W et M2 d’abord (« Moins de marche »), 19 min à pied et le S1 « Plus tôt »', async () => {
    await stack.scene('noRT');
    const r = await route(T('07:31'), WATERLOO, PROGRES);
    // 1.2.2 : le S1 arrive 16 min plus tôt, mais ses 19 min à pied en ont 9 de trop (27 min) : « Plus tôt »
    expect(labels(r)).toEqual(['short', 'earlier', 'next']);
    expect(r.journeys.map(times)).toEqual(['07:32 → 08:46', '07:34 → 08:30', '07:52 → 09:04']);
    expect(legsOf(r.journeys[0])).toBe('marche 2 | 07:36 W Waterloo Eglise → Bruxelles Midi 08:21 | marche 2 | 08:29 M2 Gare du Midi → Rogier 08:43 | marche 3');
    expect(legsOf(r.journeys[1])).toBe('marche 19 | 07:55 S1 Waterloo → Bruxelles-Nord 08:25 | marche 5');
    expect(r.journeys.map((j) => j.reason)).toEqual([
      fr('Moins de marche : 1 changement, à pied 2 + 2 + 3 min'),
      fr('Plus tôt de 16 min, mais 19 min à pied'),
      fr('Le suivant : même trajet, 20 min plus tard'),
    ]);
    const [w, m2] = rides(r.journeys[0]);
    // ligne W du TEC : trip_id normalisé pour /api/rt, noms remis en casse par le pipeline (S5)
    expect([w.op, w.line, w.tripId, w.head?.fr, w.from.name.fr]).toEqual(['tec', 'W', 'W-0724', 'Bruxelles Midi', 'Waterloo Eglise']);
    expect([m2.op, m2.line, m2.mode, m2.from.areaId, m2.to.areaId]).toEqual(['stib', '2', 'metro', 'stib:6364', 'stib:6359']);
    expect(rides(r.journeys[1])[0]).toMatchObject({ cat: 'S1', platform: '1', from: { areaId: 'sncb:8814266' }, to: { areaId: 'sncb:8812005' } });
  });

  it('CA-M5.2 : S2 vers le boulevard du Centenaire : 6 min à pied, M6 12:25 à Rogier, Roi Baudouin 12:39 (zone sans départ)', async () => {
    await stack.scene('noRT');
    const r = await route(T('12:10'), here, CENTENAIRE, S2);
    expect(legsOf(r.journeys[0])).toBe('marche 6 | 12:25 M6 Rogier → Roi Baudouin 12:39 | marche 1');
    expect(r.journeys[0].reason).toBe(fr('Le plus court : direct, à pied 6 + 1 min'));
    expect(hhmm(r.journeys[0].arr)).toBe('12:40');
    const m6 = rides(r.journeys[0])[0];
    expect([m6.fromStop, m6.toStop, m6.to.areaId, m6.rt]).toEqual(['8042', '8302', 'stib:8302', false]);
  });

  it('CA-M5.3 : Uccle à 08:00 : T3 jusqu’à Rogier puis M6 (une correspondance urbaine, M5b)', async () => {
    await stack.scene('noRT');
    const r = await route(T('08:00'), UCCLE, CENTENAIRE);
    expect(legsOf(r.journeys[0])).toBe('marche 2 | 08:09 T3 Churchill → Rogier 08:30 | 08:35 M6 Rogier → Roi Baudouin 08:49 | marche 1');
    // Rogier est une seule zone : correspondance sans marche (le PRD écrivait « à confirmer » 2 + 1 + 1)
    expect(r.journeys[0].reason).toBe(fr('Le plus court : 1 changement, à pied 2 + 1 min'));
    expect(hhmm(r.journeys[0].arr)).toBe('08:50');
  });

  it('CA-M5.4 : S3 vers Veldstraat 1 et vers l’arrêt Korenmarkt : IC puis tram 1 De Lijn', async () => {
    await stack.scene('base');
    const r = await route(T('13:55'), here, VELDSTRAAT, S3);
    const j = r.journeys[0];
    expect(legsOf(j)).toBe('14:10 IC Bruxelles-Central → Gand-Saint-Pierre 14:39 | marche 1 | 14:44 T1 Gand-Saint-Pierre → Korenmarkt, Gand 14:54 | marche 3');
    expect(hhmm(j.arr)).toBe('14:57');
    expect(j.reason).toBe(fr('Le plus court : 1 changement, à pied 1 + 3 min'));
    const tram = rides(j)[1];
    // temps réel De Lijn par le relais (700011438 à l'heure à Gand-Saint-Pierre)
    expect(tram).toMatchObject({ op: 'delijn', line: '1', mode: 'tram', head: { fr: 'Korenmarkt' }, fromStop: '200553', toStop: '200101', tripId: '700011438', rt: true, delayMin: 0 });
    expect(tram.stops?.map((s) => s.name.fr)).toEqual(['Gand-Saint-Pierre', 'Korenmarkt, Gand']);
    const k = await route(T('13:55'), here, KORENMARKT, S3);
    expect(legsOf(k.journeys[0])).toBe('14:10 IC Bruxelles-Central → Gand-Saint-Pierre 14:39 | marche 1 | 14:44 T1 Gand-Saint-Pierre → Korenmarkt, Gand 14:54');
  });

  it('CA-M5.6 : Bastogne, aucun arrêt dans la recherche élargie : noStopTo et noStopFrom, 15 min (PRD-1.2 § 1.4), 25 avec 20 min de marche', async () => {
    expect(await coreAt(T('13:55')).route(here, BASTOGNE, T('13:55'), PRESET, S3)).toEqual({ journeys: [], empty: 'noStopTo', accessMin: 15 });
    expect(await coreAt(T('13:55')).route(BASTOGNE, here, T('13:55'), PRESET, S3)).toEqual({ journeys: [], empty: 'noStopFrom', accessMin: 15 });
    expect(await coreAt(T('13:55')).route(here, BASTOGNE, T('13:55'), { ...PRESET, maxWalkMin: 20 }, S3)).toEqual({ journeys: [], empty: 'noStopTo', accessMin: 25 });
  });

  it('CA-M8.1 (fixtures) : à 23:50, une proposition pour le lendemain, jour férié (IC 08:42 DAILY, IC 09:42 HOLI)', async () => {
    await stack.scene('noRT');
    const r = await route(T('23:50'), here, bureau, S1);
    expect(labels(r)).toEqual(['short', 'next']);
    // l'IC puis le T4 d'abord ; le direct puis 12 min à pied (2 min de trop) arrive 1 min plus tard ; « Le suivant » :
    // l'IC 09:42, puis le tram qui arrive le plus tôt (§ 7.4)
    expect(r.journeys.map((j) => `${new Date(j.dep).toISOString().slice(0, 10)} ${times(j)}`)).toEqual(['2026-11-11 08:33 → 09:57', '2026-11-11 09:33 → 10:58']);
    expect(legsOf(r.journeys[1])).toBe('marche 7 | 09:42 IC Namur → Bruxelles-Nord 10:40 | marche 2 | 10:44 T3 Gare du Nord → Bourse 10:49 | marche 9');
    expect(rides(r.journeys[0]).map((l) => `${l.cat ?? l.line} ${hhmm(l.dep)}`)).toEqual(['IC 08:42', '4 09:43']);
    expect(rides(r.journeys[1])[0].tripId).toBe('88____:007::8863008:8814001:10:1052:20261231');
  });

  it('CA-M3.3, CA-M2.5 : Bruxelles-Central → Gand-Saint-Pierre (base) : simple 14:10, puis 14:22 (+3 min) et 14:40', async () => {
    await stack.scene('base');
    const fav = PRESET.favorites.find((f) => f.id === 'fav-gand');
    if (fav?.kind !== 'trip') throw new Error('preset-1.1.json migré : fav-gand');
    const r = await route(T('13:55'), fav.from, fav.to, S3);
    // « Le suivant » une seule fois : le départ d'après (14:40) complète la liste en « Plus tard »
    expect(labels(r)).toEqual(['short', 'next', 'later']);
    expect(r.journeys.map(times)).toEqual(['14:10 → 14:39', '14:25 → 14:56', '14:40 → 15:09']);
    expect(r.journeys.map((j) => j.reason)).toEqual([fr('Le plus court : direct'), fr('Le suivant : même trajet, 12 min plus tard'), fr('Plus tard : direct, départ 14:40')]);
    expect(rides(r.journeys[1])[0]).toMatchObject({ delayMin: 3, platform: '6', rt: true });
  });

  it('le soir, Bureau → Maison : le T3 puis l’IC pris à Bruxelles-Midi (9 min à pied), sinon l’IC 17:12 de Bruxelles-Central (12 min)', async () => {
    await stack.scene('noRT');
    // correctif de ce contrôle (routing/raptor.ts) : un voyage au-delà de la plage des départs n'est plus pris à
    // Bruxelles-Midi après 20 min de marche alors qu'il passe 6 min plus tard à Bruxelles-Central, à 12 min
    const direct = 'marche 12 | 17:12 IC Bruxelles-Central → Namur 18:16 | marche 7';
    const viaMidi = 'marche 9 | 16:57 T3 Bourse → Gare du Midi 17:02 | marche 1 | 17:06 IC Bruxelles-Midi → Namur 18:16 | marche 7';
    // 1.2.2 (PRD-1.2.2 § 7) : jusqu'à 16:30, le T3 jusqu'à Bruxelles-Midi garde chaque marche dans les 10 min réglées et
    // prend le même IC (même arrivée), le dernier T3 qui le fait (16:57, pas 16:09 et 52 min d'attente) ; le direct en a
    // 2 de trop : jamais « Sans changement ». 07:31 et 12:00 : aucun départ dans l'heure, la recherche de 12 h les met en
    // concurrence. « Le suivant » : le dernier tram pour l'IC de 18:06, le T4 de 17:56 (il domine le T3 de 17:53, § 7.4)
    for (const hm of ['07:31', '12:00', '15:00', '16:30']) {
      const r = await route(T(hm), here, maison, BUREAU);
      expect(r.journeys.map((j) => `${j.label} ${legsOf(j)}`), hm).toEqual([
        `short ${viaMidi}`,
        'next marche 9 | 17:56 T4 Bourse → Gare du Midi 18:01 | marche 1 | 18:06 IC Bruxelles-Midi → Namur 19:16 | marche 7',
      ]);
      expect(hhmm(r.journeys[0].leaveAt), hm).toBe('16:46');
      expect(r.journeys[0].reason, hm).toBe(fr('Le plus court : 1 changement, à pied 9 + 1 + 7 min'));
    }
    // 16:55 : le T3 de 16:57 n'est plus attrapable, le T3 suivant arrive 1 h plus tard : le direct d'abord
    const r = await route(T('16:55'), here, maison, BUREAU);
    expect(r.journeys.slice(0, 2).map((j) => `${j.label} ${legsOf(j)}`)).toEqual([`short ${direct}`, 'next marche 12 | 18:12 IC Bruxelles-Central → Namur 19:16 | marche 7']);
    expect(hhmm(r.journeys[0].leaveAt)).toBe('16:58');
    expect(r.journeys[0].reason).toBe(fr('Le plus court : direct, à pied 12 + 7 min'));
    // depuis la gare, aussi le 11/11 (férié) : IC 17:12 et 18:12, arrivées 18:16 et 19:16
    for (const day of ['2026-11-10', '2026-11-11']) {
      const r = await route(T('17:00', day), CENTRAL, maison);
      expect(r.journeys.map((j) => `${hhmm(rides(j)[0].dep)} ${hhmm(rides(j)[0].arr)}`), day).toEqual(['17:12 18:16', '18:12 19:16']);
    }
  });

  it('CA-M2.7 : trajet entièrement à pied ; à 279 m du Bureau : « tu y es » ; sans position : noPosition', async () => {
    const r = await route(T('07:31'), here, bureau, { lat: 50.848, lon: 4.352 });
    expect(r.journeys).toHaveLength(1);
    expect(r.journeys[0].legs.map((l) => l.kind)).toEqual(['walk']);
    expect(r.journeys[0]).toMatchObject({ label: 'short', transfers: 0, reason: fr('Le plus court : à pied, 9 min') });
    expect(await coreAt(T('07:31')).route(here, bureau, T('07:31'), PRESET, { lat: 50.846, lon: 4.35 })).toEqual({ journeys: [], empty: 'here' });
    expect(await coreAt(T('07:31')).route(here, bureau, T('07:31'), PRESET, null)).toEqual({ journeys: [], empty: 'noPosition' });
  });

  it('CA-M5.7 : 2 s au plus par recherche, cœur neuf (fichiers lus en HTTP)', async () => {
    await stack.scene('noRT');
    const cases: [string, Endpoint, Endpoint, { lat: number; lon: number } | undefined][] = [
      ['07:31', here, bureau, S1],
      ['07:31', here, RUE_NEUVE, S1],
      ['07:31', WATERLOO, PROGRES, undefined],
      ['08:00', UCCLE, CENTENAIRE, undefined],
      ['13:55', here, VELDSTRAAT, S3],
      ['12:10', here, CENTENAIRE, S2],
      ['23:50', here, bureau, S1],
    ];
    for (const [hm, from, to, pos] of cases) {
      const c = coreAt(T(hm));
      await c.init();
      const t0 = performance.now();
      const r = await c.route(from, to, T(hm), PRESET, pos);
      const ms = performance.now() - t0;
      expect(r.journeys.length, hm).toBeGreaterThan(0);
      expect(ms, `${hm} : ${Math.round(ms)} ms`).toBeLessThan(2000);
    }
  });
});

/* ------------------------------ temps réel des étapes en bus, tram et métro ------------------------------ */

describe('refresh() : temps réel des étapes urbaines par le relais (bus De Lijn, métro STIB)', () => {
  it('bus 460 (De Lijn, +2 min) : trajet calculé sans temps réel, puis rafraîchi : retard propagé, étiquette gardée', async () => {
    await stack.scene('noRT');
    const [j] = (await route(T('12:10'), here, MEISE, S2)).journeys;
    expect(legsOf(j)).toBe('marche 4 | 12:18 460 Bruxelles-Nord → Meise Centrum 12:40');
    const bus = rides(j)[0];
    expect([bus.op, bus.tripId, bus.fromStop, bus.toStop, bus.rt]).toEqual(['delijn', '704601218', '308613', '300450', false]);
    await stack.scene('base');
    const r = await coreAt(T('12:11')).refresh(j, PRESET);
    expect([r.id, r.label, r.reason]).toEqual([j.id, j.label, j.reason]);
    const b = rides(r)[0];
    expect([hhmm(b.schedDep), hhmm(b.dep), hhmm(b.arr), b.delayMin, b.rt]).toEqual(['12:18', '12:20', '12:42', 2, true]);
    expect([hhmm(r.leaveAt), hhmm(r.arr)]).toEqual(['12:14', '12:42']);
    // panne du temps réel ensuite : l'horaire prévu revient, signe « ~ » (rt faux)
    await stack.scene('noRT');
    const back = await coreAt(T('12:12')).refresh(r, PRESET);
    expect([hhmm(rides(back)[0].dep), rides(back)[0].rt]).toEqual(['12:18', false]);
  });

  it('métro M6 (STIB, par pointid 8042) : temps réel à l’heure après rafraîchissement', async () => {
    await stack.scene('noRT');
    const [j] = (await route(T('12:10'), here, CENTENAIRE, S2)).journeys;
    await stack.scene('base');
    const r = await coreAt(T('12:12')).refresh(j, PRESET);
    const m6 = rides(r)[0];
    expect([hhmm(m6.dep), m6.rt, m6.delayMin, r.id]).toEqual(['12:25', true, 0, j.id]);
  });
});

/* ------------------------------ favoris : réponses et ordre intelligent ------------------------------ */

async function answers(c: Core, pos: { lat: number; lon: number } | null, settings = LEGACY): Promise<Map<string, FavoriteAnswer>> {
  const m = new Map<string, FavoriteAnswer>();
  for (const f of settings.favorites) m.set(f.id, await c.answer(f, pos, settings));
  return m;
}
const order = (c: Core, pos: { lat: number; lon: number } | null, last?: Map<string, FavoriteAnswer>, settings = LEGACY) =>
  c.orderFavorites(pos, settings, last).map((x) => x.favoriteId);

describe('favoris (preset-1.1.json migré en v4, arrêts lus comme en 1.2.1) : réponses et ordre intelligent sur les données du pipeline', () => {
  it('CA-2.1, CA-2.2, CA-122.6 : préréglages 1.0 et 1.1 migrés (lieux fusionnés, arrêts dans les gares et les lignes), mêmes réponses ; « Aller à… » : Bureau 08:58, Maison ici', async () => {
    await stack.scene('noRT');
    const v10 = migrateSettings(readPreset('preset.json'));
    for (const s of [PRESET, v10]) {
      expect(s.v).toBe(4);
      expect('places' in s).toBe(false);
      expect(migrateSettings(s)).toEqual(s); // seconde lecture identique
      // arrêts favoris rangés (PRD-1.2.2 § 5) : « Namur » en gare ; « Bruxelles-Nord, bus De Lijn » toutes lignes ;
      // 1.2.6 (PRD-1.2.6 § 4) : tram 3 et tram 4 à Gare du Nord, ouverts d'office, sont des lignes suivies
      expect(s.stations.map((x) => x.id)).toEqual(['fav-namur']);
      expect(s.lines.map((x) => `${x.id} ${x.line ?? '*'}${x.near ? ' près' : ''}`)).toEqual(['fav-dl-nord *']);
      expect(s.follows?.map((x) => `${x.id} ${x.line}${x.near ? ' près' : ''} ${x.via?.areaId}`)).toEqual(['f-fav-gdn-3 3 près stib:6357F', 'f-fav-gdn-4 4 près stib:6357F']);
    }
    expect(PRESET.favorites.map((f) => `${f.kind}:${f.id}`)).toEqual(['place:fav-bureau', 'trip:fav-gand', 'place:fav-maison']);
    // 1.0 : pas de « Vers la maison » ; « Maison » devient un lieu « Jamais » en fin de liste
    expect(v10.favorites.map((f) => `${f.kind}:${f.id}`)).toEqual(['place:fav-bureau', 'trip:fav-gand', 'place:maison']);
    expect(LEGACY.favorites.map((f) => `${f.kind}:${f.id}`)).toEqual(['place:fav-bureau', 'stop:fav-gdn', 'trip:fav-gand', 'stop:fav-namur', 'stop:fav-dl-nord', 'place:fav-maison']);
    const b = PRESET.favorites[0] as Extract<Favorite, { kind: 'place' }>;
    expect(b).toMatchObject({ kind: 'place', label: 'Bureau', propose: 'morning', address: 'Bruxelles', lat: 50.8441, lon: 4.3474 });
    expect(b.src).toBeUndefined(); // lieu de la 1.0 à adresse libre : « Adresse à vérifier »
    expect(favoriteTitle(b, PRESET)).toBe('Vers le bureau');
    expect(PRESET.favorites.find((f) => f.id === 'fav-maison')).toMatchObject({ kind: 'place', label: 'Maison', propose: 'evening' });
    expect(LEGACY.favorites[1]).toMatchObject({ kind: 'stop', propose: 'near', filter: [{ line: '3', head: 'churchill' }, { line: '3', head: 'esplanade' }, { line: '4', head: 'stalle p' }] });
    const c = coreAt(T('07:31'));
    const seen: string[] = [];
    for (const s of [LEGACY, legacy(readPreset('preset.json'), v10)]) {
      const a = await answers(c, S1, s);
      expect(order(c, S1, a, s).slice(0, 2)).toEqual(['fav-bureau', 'fav-namur']);
      // « Aller à… » : les lieux dans l'ordre, avec l'arrivée de la proposition 1, ou « ici »
      const goTo = s.favorites.filter((f) => f.kind === 'place').map((f) => {
        const x = a.get(f.id)!;
        return `${(f as Extract<Favorite, { kind: 'place' }>).label} ${x.state === 'here' ? 'ici' : `arrivée ${hhmm(x.plan!.journeys[0].arr)}`}`;
      });
      expect(goTo).toEqual(['Bureau arrivée 08:58', 'Maison ici']);
      seen.push(JSON.stringify(a.get('fav-bureau')!.plan!.journeys.map(times)));
    }
    expect(seen[0]).toBe(seen[1]);
    // les lieux migrés servent d'extrémités (Endpoint « place » = favori lieu, réglages v3 sans `places`)
    expect((await coreAt(T('07:31')).route({ type: 'place', placeId: 'maison' }, { type: 'place', placeId: 'fav-bureau' }, T('07:31'), v10)).journeys[0]?.label).toBe('short');
  });

  it('CA-M1.1, S1 noRT : fav-bureau puis fav-namur en tête, « tu y es » pour fav-maison en fin de liste', async () => {
    await stack.scene('noRT');
    const c = coreAt(T('07:31'));
    expect(order(c, S1).slice(0, 2)).toEqual(['fav-bureau', 'fav-namur']);
    const a = await answers(c, S1);
    expect(order(c, S1, a)).toEqual(['fav-bureau', 'fav-namur', 'fav-gdn', 'fav-gand', 'fav-dl-nord', 'fav-maison']);
    const b = a.get('fav-bureau')!;
    expect(b.state).toBe('ok');
    const j = b.plan!.journeys[0];
    // « partir dans 2 min » / « IC à ~07:42, voie 4, 1 changement, arrivée 08:58 » (1.2.1 : puis le T3)
    expect([j.label, minutesUntil(j.leaveAt, T('07:31')), j.transfers, hhmm(j.arr)]).toEqual(['short', 2, 1, '08:58']);
    expect([hhmm(rides(j)[0].dep), rides(j)[0].platform, rides(j)[0].rt]).toEqual(['07:42', '4', false]);
    // « Namur, train » / « IC ~07:42 v.4 » / « vers Bruxelles-Midi, puis ~08:42 »
    const n = a.get('fav-namur')!.board!.departures;
    expect(n.slice(0, 2).map((d) => `${d.line} ${hhmm(d.est)} ${d.platform} ${d.head.fr} ${d.rt}`)).toEqual(['IC 07:42 4 Bruxelles-Midi false', 'IC 08:42 5 Bruxelles-Midi false']);
    expect(a.get('fav-maison')).toMatchObject({ state: 'here', plan: { journeys: [], empty: 'here' } });
  });

  it('CA-M1.2, S1 base : « partir dans 4 min », IC 07:42 (+2 min) voie 6, arrivée 08:58 ; Namur « IC 07:42 +2 v.6 »', async () => {
    await stack.scene('base');
    const c = coreAt(T('07:31'));
    const j = (await c.answer(PRESET.favorites[0], S1, PRESET)).plan!.journeys[0];
    const ic = rides(j)[0];
    // 1.2.1 : IC puis T3 (attrapable malgré les 2 min de retard), arrivée 08:58
    expect([minutesUntil(j.leaveAt, T('07:31')), hhmm(ic.schedDep), ic.delayMin, ic.newPlatform, hhmm(j.arr)]).toEqual([4, '07:42', 2, '6', '08:58']);
    const d = (await c.answer(LEGACY.favorites.find((f) => f.id === 'fav-namur')!, S1, LEGACY)).board!.departures[0];
    expect([d.line, hhmm(d.sched), d.delayMin, d.newPlatform, d.rt]).toEqual(['IC', '07:42', 2, '6', true]);
  });

  it('CA-M1.3, S2 base : tram et bus De Lijn en tête ; « Autres favoris » = bureau, Gand, Namur, maison', async () => {
    await stack.scene('base');
    const now = T('12:10');
    const c = coreAt(now);
    const a = await answers(c, S2);
    // fav-maison : premier IC vers Namur le soir (plus de 3 h) ; fav-namur : prochain départ demain (règle 5)
    expect(order(c, S2, a)).toEqual(['fav-gdn', 'fav-dl-nord', 'fav-bureau', 'fav-gand', 'fav-namur', 'fav-maison']);
    expect(a.get('fav-gdn')!.board!.departures.slice(0, 2).map((d) => depText(d, now))).toEqual(['T3 Churchill 2\u00a0min', 'T4 Stalle (P) 5\u00a0min']);
    const dl = a.get('fav-dl-nord')!.board!.departures;
    expect(dl.slice(0, 2).map((d) => `${depText(d, now)}${d.delayMin ? ` +${d.delayMin}` : ''}`)).toEqual(['232 Vilvorde ~5\u00a0min', '460 Meise 10\u00a0min +2']);
    // « Vers Gand-Saint-Pierre » / « départ 14:10 » / « IC voie 4 à Bruxelles-Central, arrivée 14:39 »
    const g = a.get('fav-gand')!;
    expect(g.fromStation).toBe(true);
    const ic = rides(g.plan!.journeys[0])[0];
    expect([hhmm(ic.dep), ic.platform, ic.from.areaId, hhmm(g.plan!.journeys[0].arr)]).toEqual(['14:10', '4', 'sncb:8813003', '14:39']);
  });

  it('CA-M1.4, S3 base : fav-gand en tête, « partir dans 13 min », IC 14:10 voie 4, direct, arrivée 14:39', async () => {
    await stack.scene('base');
    const c = coreAt(T('13:55'));
    const a = await answers(c, S3);
    expect(order(c, S3, a)[0]).toBe('fav-gand');
    const g = a.get('fav-gand')!;
    expect(g.fromStation).toBeUndefined();
    const j = g.plan!.journeys[0];
    expect([minutesUntil(j.leaveAt, T('13:55')), hhmm(rides(j)[0].dep), rides(j)[0].platform, j.transfers, hhmm(j.arr), j.reason]).toEqual([13, '14:10', '4', 0, '14:39', fr('Le plus court : direct')]);
  });

  it('CA-M1.5 : au Bureau à 07:31, « Vers le bureau » répond « tu y es » et passe en fin de liste (règle 5)', async () => {
    await stack.scene('noRT');
    const c = coreAt(T('07:31'));
    const a = await answers(c, BUREAU);
    expect(a.get('fav-bureau')).toMatchObject({ state: 'here' });
    const ranks = c.orderFavorites(BUREAU, LEGACY, a);
    expect(ranks.find((x) => x.favoriteId === 'fav-bureau')?.rule).toBe(5);
    expect(ranks.slice(-2).map((x) => x.favoriteId)).toEqual(['fav-bureau', 'fav-maison']); // à égalité : ordre du téléphone
  });

  it('CA-S3.2 : « Dans mon ordre » : l’ordre du téléphone, sauf la règle 5', async () => {
    await stack.scene('noRT');
    const mine: Settings = { ...LEGACY, display: { ...LEGACY.display, favOrder: 'mine' }, favorites: [LEGACY.favorites[3], ...LEGACY.favorites.filter((_, i) => i !== 3)] };
    const c = coreAt(T('12:10'));
    const a = await answers(c, S2, mine);
    expect(order(c, S2, a, mine)).toEqual(['fav-bureau', 'fav-gdn', 'fav-gand', 'fav-dl-nord', 'fav-namur', 'fav-maison']);
    expect(order(c, S2, undefined, mine)).toEqual(mine.favorites.map((f) => f.id));
  });

  it('zone d’un arrêt favori disparue : retrouvée par opérateur, nom et position (moins de 150 m), sinon « introuvable »', async () => {
    await stack.scene('noRT');
    const c = coreAt(T('12:10'));
    const gdn = LEGACY.favorites.find((f) => f.id === 'fav-gdn') as Extract<Favorite, { kind: 'stop' }>;
    const moved = await c.answer({ ...gdn, id: 'fav-ancien', areaId: 'stib:6358X' }, S2, LEGACY);
    expect(moved.state).toBe('ok');
    expect(moved.movedTo?.id).toBe('stib:6357F');
    expect(moved.board!.departures.map((d) => `${lineLabel(d.mode, d.line)} ${d.head.fr}`).slice(0, 3)).toEqual(['T3 Churchill', 'T4 Stalle (P)', 'T3 Esplanade']);
    const lost = await c.answer({ ...gdn, id: 'fav-perdu', areaId: 'stib:9999', name: { fr: 'Nulle part', nl: 'Nergens' } }, S2, LEGACY);
    expect(lost).toMatchObject({ state: 'missing' });
    // une seule zone « Gare du Nord » STIB autour de (50.8600, 4.3600), 500 m (CA-M8.3 sur les fixtures)
    const near = await c.nearby(50.86, 4.36, 500);
    expect(near.filter((x) => x.area.op === 'stib' && x.area.n.fr === 'Gare du Nord').map((x) => x.area.id)).toEqual(['stib:6357F']);
  });
});

/* ------------------------------ zones fusionnées (M8.3) : du pipeline au favori ------------------------------ */

/**
 * Variante du réseau de test : à la gare du Nord, les arrêts STIB 6357F et 6358 ont chacun leur gare parente (comme
 * les arrêts tram et bus des vraies données), et la ligne 4 devient un bus. Le pipeline doit fusionner les deux zones
 * de même nom à moins de 300 m (`aka`), et le cœur retrouver un favori enregistré sur l'une ou l'autre.
 */
function mergedVariantZip(): Buffer {
  const feeds = buildFeeds(loadNetwork());
  const stib = { ...feeds.stib };
  const parent = (id: string, p: string) => (line: string) => (line.startsWith(`${id},`) ? line.replace(/,0,$/, `,0,${p}`) : line);
  const edit = (name: string, f: (lines: string[]) => string[]) => {
    const eol = stib[name].includes('\r\n') ? '\r\n' : '\n';
    const lines = stib[name].split(/\r?\n/);
    const last = lines[lines.length - 1] === '' ? lines.pop() : undefined;
    stib[name] = [...f(lines), ...(last !== undefined ? [last] : [])].join(eol);
  };
  edit('stops.txt', (ls) => [
    ...ls.map(parent('6357F', 'PGDN1')).map(parent('6358', 'PGDN2')),
    'PGDN1,,GARE DU NORD,,50.86000,4.36014,,,1,',
    'PGDN2,,GARE DU NORD,,50.86008,4.36020,,,1,',
  ]);
  edit('translations.txt', (ls) => [...ls, 'stops,stop_name,fr,GARE DU NORD,PGDN1,,', 'stops,stop_name,nl,NOORDSTATION,PGDN1,,', 'stops,stop_name,fr,GARE DU NORD,PGDN2,,', 'stops,stop_name,nl,NOORDSTATION,PGDN2,,']);
  edit('routes.txt', (ls) => ls.map((l) => (l.startsWith('4,') ? l.split(',').map((c, i) => (i === 5 ? '3' : c)).join(',') : l)));
  expect(stib['stops.txt']).toContain(',0,PGDN1');
  expect(stib['stops.txt']).toContain(',0,PGDN2');
  return feedZip(stib);
}

describe('zones fusionnées (M8.3) : pipeline, tuiles, nearby() et favoris', () => {
  let tmp: string;
  let dataDir: string;
  let server: Proc;
  const coreV = (now: number) => createCore({ dataBase: server.url, relayBase: stack.relay.url, now: () => now, storage: memoryKV(), fetch });

  beforeAll(async () => {
    // les zips de fixtures sont bien ceux que produit make-gtfs.ts : la variante ne diffère que par la fusion
    expect(feedZip(buildFeeds(loadNetwork()).stib).equals(readFileSync(join(GTFS, 'stib.zip')))).toBe(true);
    tmp = mkdtempSync(join(tmpdir(), 'quai-e2e-fusion-'));
    writeFileSync(join(tmp, 'stib.zip'), mergedVariantZip());
    const sources = ['sncb', 'stib', 'delijn', 'tec'].map((op) => `${op}=${op === 'stib' ? join(tmp, 'stib.zip') : join(GTFS, `${op}.zip`)}`).join(',');
    ({ dir: dataDir } = await buildFixtureData({ sources, out: join(tmp, 'data') }));
    server = await startDataServer(dataDir);
    await stack.scene('base');
  });
  afterAll(async () => {
    await server?.stop();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('pipeline : une zone « Gare du Nord » STIB, tram et bus, aka de l’autre ; validateur sans erreur', () => {
    const r = validateData(dataDir);
    expect(r.errors).toEqual([]);
    const all = listJson(dataDir, 'tiles').flatMap((f) => readJ<TileFile>(dataDir, f).areas);
    const gdn = all.filter((a) => a.op === 'stib' && a.n.fr === 'Gare du Nord');
    expect(gdn).toHaveLength(1);
    expect(gdn[0]).toMatchObject({ id: 'stib:PGDN1', n: { fr: 'Gare du Nord', nl: 'Noordstation' }, modes: ['tram', 'bus'], aka: ['stib:PGDN2'] });
    const file = readJ<AreaFile>(dataDir, 'areas/stib/PGDN1.json');
    expect(file.stops.map((s) => [s.id, s.rt])).toEqual([['6357F', '6357'], ['6358', '6358']]);
    expect(() => readJ(dataDir, 'areas/stib/PGDN2.json')).toThrow();
  });

  it('nearby() : une seule entrée « Gare du Nord » STIB ; board() accepte l’ancien identifiant (aka)', async () => {
    const c = coreV(T('12:10'));
    const near = await c.nearby(50.86, 4.36, 500);
    const gdn = near.filter((x) => x.area.op === 'stib' && x.area.n.fr === 'Gare du Nord');
    expect(gdn.map((x) => x.area.id)).toEqual(['stib:PGDN1']);
    expect(gdn[0].area.modes).toEqual(['tram', 'bus']);
    const b = await c.board('stib:PGDN2', { limit: 6 });
    expect(b.area.id).toBe('stib:PGDN1');
    expect(new Set(b.departures.map((d) => d.mode))).toEqual(new Set(['tram', 'bus']));
    // temps réel STIB par pointid, inchangé par la fusion
    expect(b.departures.slice(0, 2).map((d) => depText(d, T('12:10')))).toEqual(['T3 Churchill 2\u00a0min', '4 Stalle (P) 5\u00a0min']);
  });

  it('favori enregistré sur la zone absorbée (aka) ou sur l’identifiant 1.0 (stib:6357F) : retrouvé, filtre gardé', async () => {
    const gdn = LEGACY.favorites.find((f) => f.id === 'fav-gdn') as Extract<Favorite, { kind: 'stop' }>;
    for (const areaId of ['stib:PGDN2', 'stib:6357F']) {
      // cœur neuf : aucune tuile chargée avant la réponse du favori
      const a = await coreV(T('12:10')).answer({ ...gdn, areaId }, S2, LEGACY);
      expect(a.state, areaId).toBe('ok');
      expect(a.movedTo?.id, areaId).toBe('stib:PGDN1');
      expect(a.movedTo?.aka, areaId).toEqual(['stib:PGDN2']);
      expect(a.board!.departures.map((d) => `${lineLabel(d.mode, d.line)} ${d.head.fr}`).slice(0, 3), areaId).toEqual(['T3 Churchill', '4 Stalle (P)', 'T3 Esplanade']);
    }
  });
});
