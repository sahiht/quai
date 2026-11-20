/**
 * 1.3.0 (PRD-1.3.0 § 6.4) : journal des trajets (core/journal.ts). Enregistrement et relecture, regroupement en
 * arrière-plan, plafonds (10 trajets, 60 ko, milieu d'un trajet oublié), ordre, contenu abîmé, refus des coordonnées et
 * des adresses, texte en français à l'heure de Bruxelles (heure d'été comprise), branchement dans main.ts et
 * web/main.ts. Lieux publics seulement.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KV } from '../../src/core/api';
import {
  createJournal,
  JOURNAL_ADDRESS_TITLE,
  JOURNAL_FORGOTTEN,
  JOURNAL_KEY,
  JOURNAL_MAX_BYTES,
  JOURNAL_MAX_TRIPS,
  JOURNAL_MOMENT_WORDS,
  JOURNAL_SAVE_MS,
  looksLikeAddress,
  looksLikeCoordinates,
  refusedKey,
  utf8Bytes,
} from '../../src/core/journal';
import type { JournalTrip } from '../../src/core/journal-types';
import { checkLines, GUIDE_TEXT } from '../../src/glasses/guide-views';
import { APP_VERSION } from '../../src/version';

const NB = '\u00a0';

/** Stockage en mémoire : ce qui est enregistré sous `quai.journal`, et chaque écriture. */
function memKV(init?: string) {
  const data = new Map<string, string>();
  if (init !== undefined) data.set(JOURNAL_KEY, init);
  const writes: string[] = [];
  const kv: KV = {
    async get(k) {
      return data.get(k) ?? null;
    },
    async set(k, v) {
      writes.push(k);
      data.set(k, v);
    },
  };
  return { kv, writes, stored: (): string | null => data.get(JOURNAL_KEY) ?? null };
}

/** 15/11/2026 08:00:00 à Bruxelles (heure d'hiver, UTC+1). */
const T0 = Date.UTC(2026, 10, 15, 7, 0, 0);
const at = (sec: number): number => T0 + sec * 1000;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('enregistrement et relecture', () => {
  it('le journal enregistré { v: 1, trips } est relu tel quel par un nouveau journal (liste et texte)', async () => {
    const m = memKV();
    const j = await createJournal(m.kv);
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: T0 });
    j.add(id, { t: at(130), k: 'moment', d: { m: 'leave', id: 'leave:j1' } });
    j.add(id, { t: at(600), k: 'boarded', d: { line: 'bus 71' } });
    j.end(id, 'done', at(1500));
    await j.flush();
    const saved = JSON.parse(m.stored()!);
    expect(saved.v).toBe(1);
    expect(saved.trips).toHaveLength(1);
    expect(saved.trips[0]).toMatchObject({ id, title: 'Bureau', kind: 'trip', startedAt: T0, endedAt: at(1500), end: 'done' });
    expect(saved.trips[0].events.map((e: { k: string }) => e.k)).toEqual(['start', 'moment', 'boarded', 'end']);

    const again = await createJournal(m.kv);
    expect(again.list()).toEqual(j.list());
    expect(again.text(id)).toBe(j.text(id));
    expect(again.text(id)).toContain('08:02:10 Partir maintenant affiché');
  });

  it('répond tout de suite, regroupe les événements (2 s), enregistre tout de suite au début, à end() et à clear()', async () => {
    vi.useFakeTimers();
    const m = memKV();
    const j = await createJournal(m.kv);
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: T0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(m.writes).toHaveLength(1);

    for (let i = 1; i <= 5; i++) j.add(id, { t: at(i), k: 'positions', d: { n: i } });
    // en mémoire, sans attendre l'enregistrement
    expect(j.list()[0].events).toHaveLength(6);
    expect(j.text(id).split('\n')).toHaveLength(7);
    await vi.advanceTimersByTimeAsync(JOURNAL_SAVE_MS - 1);
    expect(m.writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.writes).toHaveLength(2);
    expect(JSON.parse(m.stored()!).trips[0].events).toHaveLength(6);

    j.add(id, { t: at(10), k: 'arrived' });
    j.end(id, 'done', at(11));
    await vi.advanceTimersByTimeAsync(0);
    expect(m.writes).toHaveLength(3);
    expect(JSON.parse(m.stored()!).trips[0]).toMatchObject({ end: 'done', endedAt: at(11) });
    expect(JSON.parse(m.stored()!).trips[0].events.map((e: { k: string }) => e.k).slice(-2)).toEqual(['arrived', 'end']);
    await vi.advanceTimersByTimeAsync(10 * JOURNAL_SAVE_MS);
    expect(m.writes).toHaveLength(3);

    j.clear();
    expect(j.list()).toEqual([]);
    expect(j.text(id)).toBe('');
    await vi.advanceTimersByTimeAsync(0);
    expect(m.writes).toHaveLength(4);
    expect(JSON.parse(m.stored()!)).toEqual({ v: 1, trips: [] });
    expect((await createJournal(m.kv)).list()).toEqual([]);
  });

  it('un enregistrement qui échoue ne casse rien et se refait au changement suivant', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = memKV();
    let fail = true;
    const kv: KV = {
      get: m.kv.get,
      async set(k, v) {
        if (fail) throw new Error('stockage plein');
        await m.kv.set(k, v);
      },
    };
    const j = await createJournal(kv);
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: T0 });
    await j.flush();
    expect(m.stored()).toBeNull();
    expect(j.list()).toHaveLength(1);
    fail = false;
    j.end(id, 'stopped', at(60));
    await j.flush();
    expect(JSON.parse(m.stored()!).trips[0]).toMatchObject({ id, title: 'Bureau', end: 'stopped' });
  });

  it('end() sur un trajet inconnu : rien ; add() sur un trajet inconnu : rien', async () => {
    const m = memKV();
    const j = await createJournal(m.kv);
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: T0 });
    await j.flush();
    const before = m.stored();
    const writes = m.writes.length;
    j.end('inconnu', 'done', at(10));
    j.add('inconnu', { t: at(5), k: 'arrived' });
    await j.flush();
    expect(m.writes).toHaveLength(writes);
    expect(m.stored()).toBe(before);
    expect(j.list()).toHaveLength(1);
    expect(j.list()[0]).not.toHaveProperty('end');
    expect(j.list()[0].events.map((e) => e.k)).toEqual(['start']);
    expect(j.text('inconnu')).toBe('');
    expect(j.list()[0].id).toBe(id);
  });

  it('une seule ligne de début et une seule de fin : un « start » ajouté complète le début, un « end » ajouté vaut end(), la première fin compte', async () => {
    const j = await createJournal(memKV().kv);
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: T0 });
    j.add(id, { t: at(1), k: 'start', d: { title: 'Bureau', kind: 'trip', legs: 3 } });
    j.add(id, { t: at(2), k: 'end', d: { end: 'stopped' } });
    j.end(id, 'done', at(3));
    j.add(id, { t: at(4), k: 'end', d: { end: 'replaced' } });
    const trip = j.list()[0];
    expect(trip).toMatchObject({ end: 'stopped', endedAt: at(2) });
    expect(trip.events).toEqual([
      { t: T0, k: 'start', d: { title: 'Bureau', kind: 'trip', legs: 3 } },
      { t: at(2), k: 'end', d: { end: 'stopped' } },
    ]);
  });

  it('jamais d’exception, même avec des entrées impossibles', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const now = (): number => at(42);
    const j = await createJournal(memKV().kv, { now });
    const bad = j as unknown as Record<string, (...a: unknown[]) => unknown>;
    const id = bad.begin(null) as string;
    expect(typeof id).toBe('string');
    expect(j.list()[0]).toMatchObject({ id, title: '', kind: 'trip', startedAt: at(42) });
    for (const e of [null, undefined, 42, 'x', [], { k: '' }, { k: 42 }, { t: 'x' }, { k: 'moment', d: [1, 2] }, { k: 'moment', d: { m: { x: 1 }, n: NaN, z: Infinity } }]) {
      expect(() => bad.add(id, e)).not.toThrow();
    }
    expect(() => bad.end(id, 'nimporte', 'x')).not.toThrow();
    const trip = j.list()[0];
    expect(trip).toMatchObject({ end: 'ended', endedAt: at(42) });
    expect(trip.events).toEqual([
      { t: at(42), k: 'start', d: { kind: 'trip' } },
      { t: at(42), k: 'moment' },
      { t: at(42), k: 'moment' },
      { t: at(42), k: 'end', d: { end: 'ended' } },
    ]);
    expect(() => bad.text(undefined)).not.toThrow();
    expect(() => bad.add(undefined, undefined)).not.toThrow();
  });

  it('list() rend des copies : la modifier ne change pas le journal', async () => {
    const j = await createJournal(memKV().kv);
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: T0 });
    const copy = j.list();
    copy[0].title = 'Autre';
    copy[0].events.push({ t: at(1), k: 'arrived' });
    copy[0].events[0].d!.kind = 'ride';
    copy.pop();
    expect(j.list()).toEqual([{ id, title: 'Bureau', kind: 'trip', startedAt: T0, events: [{ t: T0, k: 'start', d: { title: 'Bureau', kind: 'trip' } }] }]);
  });
});

describe('ordre et plafonds', () => {
  it('list() du plus récent au plus ancien, aussi après relecture ; identifiants uniques même à la même heure', async () => {
    const m = memKV();
    const j = await createJournal(m.kv);
    const a = j.begin({ title: 'Gare du Midi', kind: 'trip', at: T0 });
    const b = j.begin({ title: 'Vers Gare des Guillemins', kind: 'ride', at: at(3600) });
    const c = j.begin({ title: 'Bureau', kind: 'trip', at: at(3600) });
    expect(new Set([a, b, c]).size).toBe(3);
    expect(j.list().map((t) => t.id)).toEqual([c, b, a]);
    await j.flush();
    expect(JSON.parse(m.stored()!).trips.map((t: JournalTrip) => t.id)).toEqual([a, b, c]);
    expect((await createJournal(m.kv)).list().map((t) => t.id)).toEqual([c, b, a]);
  });

  it('10 trajets au plus : le plus ancien oublié d’abord', async () => {
    const m = memKV();
    const j = await createJournal(m.kv);
    const ids = Array.from({ length: 12 }, (_, i) => j.begin({ title: `Trajet ${i + 1}`, kind: 'trip', at: at(i * 600) }));
    expect(JOURNAL_MAX_TRIPS).toBe(10);
    expect(j.list().map((t) => t.title)).toEqual(Array.from({ length: 10 }, (_, i) => `Trajet ${12 - i}`));
    expect(j.text(ids[0])).toBe('');
    j.add(ids[1], { t: at(5000), k: 'arrived' });
    expect(j.list().some((t) => t.id === ids[1])).toBe(false);
    await j.flush();
    expect(JSON.parse(m.stored()!).trips.map((t: JournalTrip) => t.title)).toEqual(Array.from({ length: 10 }, (_, i) => `Trajet ${i + 3}`));
  });

  it('60 ko au plus : les plus anciens trajets oubliés d’abord, les plus récents gardés entiers', async () => {
    const m = memKV();
    const j = await createJournal(m.kv);
    const ids: string[] = [];
    for (let n = 0; n < 8; n++) {
      const id = j.begin({ title: `Trajet ${n + 1}`, kind: 'trip', at: at(n * 7200) });
      ids.push(id);
      for (let i = 0; i < 160; i++) j.add(id, { t: at(n * 7200 + i * 10), k: 'positions', d: { n: i, acc: 12.5, gap: 30 } });
      j.end(id, 'done', at(n * 7200 + 1700));
    }
    await j.flush();
    const raw = m.stored()!;
    expect(JOURNAL_MAX_BYTES).toBe(60_000);
    expect(utf8Bytes(raw)).toBeLessThanOrEqual(JOURNAL_MAX_BYTES);
    const kept = j.list();
    expect(kept.length).toBeGreaterThan(1);
    expect(kept.length).toBeLessThan(8);
    expect(kept.map((t) => t.id)).toEqual(ids.slice(-kept.length).reverse());
    for (const t of kept) expect(t.events).toHaveLength(162);
    // aucun trajet oublié de trop : un de plus n'aurait pas tenu
    const one = utf8Bytes(JSON.stringify(JSON.parse(raw).trips[0]));
    expect(utf8Bytes(raw) + one + 1).toBeGreaterThan(JOURNAL_MAX_BYTES);
    expect(raw).not.toContain(JOURNAL_FORGOTTEN);
    expect(JSON.parse(raw).trips).toEqual(JSON.parse(JSON.stringify(kept.slice().reverse())));
  });

  it('un trajet seul trop long : son début et sa fin restent, le milieu devient « n événements oubliés », compté juste', async () => {
    const m = memKV();
    const j = await createJournal(m.kv);
    const old = j.begin({ title: 'Gare du Midi', kind: 'trip', at: T0 - 86_400_000 });
    j.end(old, 'done', T0 - 86_000_000);
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: T0 });
    const N = 1500;
    const moment = (i: number) => ({ t: at(i), k: 'moment', d: { m: i % 2 ? 'leave' : 'turn', id: `turn:j${i}` } });
    for (let i = 1; i <= N; i++) j.add(id, moment(i));
    await j.flush();
    expect(utf8Bytes(m.stored()!)).toBeLessThanOrEqual(JOURNAL_MAX_BYTES);

    const check = (trip: JournalTrip, total: number, last: number) => {
      const ev = trip.events;
      const marks = ev.filter((e) => e.k === JOURNAL_FORGOTTEN);
      expect(marks).toHaveLength(1);
      const mark = ev.indexOf(marks[0]);
      const tail = ev.slice(mark + 1);
      // le début : « start » puis les premiers événements, dans l'ordre
      expect(ev[0]).toMatchObject({ t: T0, k: 'start' });
      expect(mark).toBeGreaterThan(5);
      expect(ev.slice(1, mark).map((e) => e.t)).toEqual(Array.from({ length: mark - 1 }, (_, i) => at(i + 1)));
      // la fin : les derniers, jusqu'au dernier écrit
      expect(tail.length).toBeGreaterThan(5);
      expect(tail.map((e) => e.t)).toEqual(Array.from({ length: tail.length }, (_, i) => at(last - tail.length + 1 + i)));
      // rien de perdu sans être compté ; le repère à l'heure du premier oublié
      const n = Number(marks[0].d!.n);
      expect(mark + n + tail.length).toBe(total);
      expect(marks[0].t).toBe(at(mark));
      expect(j.text(id)).toContain(`${n} événements oubliés`);
      return { mark, n };
    };
    const [trip, ...rest] = j.list();
    expect(rest).toEqual([]);
    expect(trip.id).toBe(id);
    const first = check(trip, N + 1, N);

    // le trajet continue : toujours un seul repère, le même début, le compte suit
    for (let i = N + 1; i <= N + 400; i++) j.add(id, moment(i));
    j.end(id, 'done', at(N + 401));
    await j.flush();
    expect(utf8Bytes(m.stored()!)).toBeLessThanOrEqual(JOURNAL_MAX_BYTES);
    const after = j.list()[0];
    expect(after.events[after.events.length - 1]).toEqual({ t: at(N + 401), k: 'end', d: { end: 'done' } });
    const second = check({ ...after, events: after.events.slice(0, -1) }, N + 401, N + 400);
    expect(second.mark).toBe(first.mark);
    expect(second.n).toBeGreaterThan(first.n);
    // relu tel quel
    expect((await createJournal(m.kv)).list()).toEqual(j.list());
  });

  it('une boucle qui écrit sans fin reste rapide et sous 60 ko, sans rien perdre du dernier événement', async () => {
    const m = memKV();
    const j = await createJournal(m.kv);
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: T0 });
    const t0 = performance.now();
    for (let i = 1; i <= 20_000; i++) j.add(id, { t: at(i), k: 'positions', d: { n: i, acc: 10, gap: 1 } });
    const ev = j.list()[0].events;
    expect(performance.now() - t0).toBeLessThan(5000);
    await j.flush();
    expect(utf8Bytes(m.stored()!)).toBeLessThanOrEqual(JOURNAL_MAX_BYTES);
    expect(ev[0].k).toBe('start');
    expect(ev[ev.length - 1]).toEqual({ t: at(20_000), k: 'positions', d: { n: 20_000, acc: 10, gap: 1 } });
    expect(ev.filter((e) => e.k === JOURNAL_FORGOTTEN)).toHaveLength(1);
  });
});

describe('contenu abîmé', () => {
  it.each([
    ['pas du JSON', 'pas du json {'],
    ['autre version', JSON.stringify({ v: 2, trips: [{ id: 'a', title: 'Bureau', kind: 'trip', startedAt: T0, events: [] }] })],
    ['sans version', '{"trips":[]}'],
    ['trajets illisibles', '{"v":1,"trips":"x"}'],
    ['sans trajets', '{"v":1}'],
    ['nul', 'null'],
    ['tableau', '[1,2]'],
    ['nombre', '42'],
    ['texte', '"journal"'],
    ['vide', ''],
  ])('%s : journal vide, jamais d’exception, et le journal suivant s’enregistre propre', async (_, raw) => {
    const m = memKV(raw);
    const j = await createJournal(m.kv);
    expect(j.list()).toEqual([]);
    expect(j.text('x')).toBe('');
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: T0 });
    await j.flush();
    expect(JSON.parse(m.stored()!)).toMatchObject({ v: 1, trips: [{ id, title: 'Bureau' }] });
  });

  it('stockage muet ou bizarre : journal vide, jamais d’exception', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kvs: KV[] = [
      { get: async () => Promise.reject(new Error('pont fermé')), set: async () => {} },
      {
        get: () => {
          throw new Error('tout de suite');
        },
        set: async () => {},
      },
      { get: async () => 42 as unknown as string, set: async () => {} },
      { get: async () => ({ v: 1, trips: [] }) as unknown as string, set: async () => {} },
    ];
    for (const kv of kvs) {
      const j = await createJournal(kv);
      expect(j.list()).toEqual([]);
      expect(typeof j.begin({ title: 'Bureau', kind: 'trip', at: T0 })).toBe('string');
    }
  });

  it('trajets en partie abîmés : les trajets lisibles restent, les événements illisibles sont laissés', async () => {
    const raw = JSON.stringify({
      v: 1,
      trips: [
        null,
        'x',
        { id: '', startedAt: T0 },
        { id: 'a', startedAt: 'hier' },
        { id: 'b', title: 'Bureau', kind: 'trip', startedAt: T0, events: [null, { k: 'moment', t: at(1), d: { m: 'leave' } }, { t: at(2) }, { k: 'arrived', t: 'x' }] },
        { id: 'b', title: 'Doublon', kind: 'trip', startedAt: T0, events: [] },
        { id: 'c', title: 'Gare du Midi', kind: 'bizarre', startedAt: at(60), end: 'nimporte', endedAt: 'x', events: 'pas un tableau' },
      ],
    });
    const j = await createJournal(memKV(raw).kv);
    expect(j.list().map((t) => [t.id, t.title, t.kind, t.end, t.endedAt])).toEqual([
      ['c', 'Gare du Midi', 'trip', undefined, undefined],
      ['b', 'Bureau', 'trip', undefined, undefined],
    ]);
    expect(j.list()[1].events).toEqual([
      { t: at(1), k: 'moment', d: { m: 'leave' } },
      { t: T0, k: 'arrived' },
    ]);
  });
});

describe('jamais de coordonnées ni d’adresse', () => {
  const COORD_KEYS = /"(?:lat|lon|lng|latitude|longitude|address|adresse)"\s*:/i;

  it('add() retire les clés lat, lon, lng, latitude, longitude, address, adresse (toute casse, aussi dans un nom composé) et les valeurs qui ressemblent à une position ou à une adresse', async () => {
    const m = memKV();
    const j = await createJournal(m.kv);
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: T0 });
    j.add(id, {
      t: at(1),
      k: 'alighted',
      d: {
        stop: 'Bruxelles-Central',
        line: 'IC',
        n: 3,
        ok: true,
        lat: 50.8466,
        LON: 4.3528,
        Lng: 4.3528,
        latitude: 50.8466,
        Longitude: 4.3528,
        ADDRESS: 'Rue de la Loi 16',
        adresse: 'Grand-Place',
        Adresse: 'Place Flagey',
        fromLat: 50.8466,
        to_lon: 4.3528,
        homeAddress: 'Gare du Midi',
        latLon: 'x',
        coords: 'x',
        where: '50.8466, 4.3528',
        fr: '50,8466 ; 4,3528',
        dms: '50°50′48″ N 4°21′10″ E',
        named: 'lat 50.84',
        point: 'POINT(4.3528 50.8466)',
        dest: 'Rue de la Loi 16, 1000 Bruxelles',
        nl: 'Wetstraat 16',
        first: '16 rue de la Loi',
      },
    });
    expect(j.list()[0].events[1]).toEqual({ t: at(1), k: 'alighted', d: { stop: 'Bruxelles-Central', line: 'IC', n: 3, ok: true } });
    await j.flush();
    const raw = m.stored()!;
    expect(raw).not.toMatch(COORD_KEYS);
    expect(raw).not.toMatch(/50[.,]84|4[.,]35|Loi 16|Wetstraat|POINT|°/);
    expect(j.text(id)).not.toMatch(/50[.,]84|4[.,]35|Loi/);
  });

  it('aucun événement ne garde de clé de position, quelle que soit sa sorte ; nombres arrondis au dixième', async () => {
    const m = memKV();
    const j = await createJournal(m.kv);
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: T0 });
    const kinds = ['start', 'battery', 'moment', 'clear', 'remind', 'seen', 'boarded', 'alighted', 'replan', 'passed', 'arrived', 'positions', 'fg', 'glasses', 'check', 'essai'];
    kinds.forEach((k, i) => j.add(id, { t: at(i + 1), k, d: { lat: 50.8466, lon: 4.3528, latitude: 50.8466, longitude: 4.3528, address: 'Rue de la Loi 16', adresse: 'Rue de la Loi 16' } }));
    j.add(id, { t: at(30), k: 'positions', d: { n: 12, acc: 14.4567, gap: 63.25, x: 50.846612, y: 4.352812 } });
    j.end(id, 'done', at(40));
    await j.flush();
    const raw = m.stored()!;
    expect(raw).not.toMatch(COORD_KEYS);
    expect(raw).not.toMatch(/50\.84|4\.35/);
    expect(j.list()[0].events.find((e) => e.t === at(30))).toEqual({ t: at(30), k: 'positions', d: { n: 12, acc: 14.5, gap: 63.3, x: 50.8, y: 4.4 } });
  });

  it('un titre qui est une adresse ou une position devient « Adresse » ; un arrêt, une gare, un favori restent', async () => {
    const m = memKV();
    const j = await createJournal(m.kv);
    for (const [title, want] of [
      ['Rue de la Loi 16', JOURNAL_ADDRESS_TITLE],
      ['Vers Rue de la Loi 16, 1000 Bruxelles', JOURNAL_ADDRESS_TITLE],
      ['Wetstraat 16', JOURNAL_ADDRESS_TITLE],
      ['50.8466, 4.3528', JOURNAL_ADDRESS_TITLE],
      ['Vers Gare des Guillemins', 'Vers Gare des Guillemins'],
      ['Place Flagey', 'Place Flagey'],
      ['Bureau', 'Bureau'],
    ]) {
      const id = j.begin({ title, kind: 'trip', at: T0 });
      expect(j.list()[0].title).toBe(want);
      expect(j.text(id).split('\n')[0]).toBe(`Journal Quai ${APP_VERSION}, trajet «${NB}${want}${NB}», 15/11/2026`);
    }
    await j.flush();
    expect(m.stored()).not.toMatch(/Loi 16|Wetstraat|50\.84/);
  });

  it('un journal enregistré avec des coordonnées (autre écrivain) est relu sans elles et réenregistré propre', async () => {
    const raw = JSON.stringify({
      v: 1,
      trips: [{ id: 'a', title: 'Rue de la Loi 16', kind: 'trip', startedAt: T0, events: [{ t: T0, k: 'start', d: { lat: 50.8466, lon: 4.3528, where: '50.8466, 4.3528', stop: 'Gare du Midi' } }] }],
    });
    const m = memKV(raw);
    const j = await createJournal(m.kv);
    expect(j.list()[0]).toMatchObject({ title: JOURNAL_ADDRESS_TITLE, events: [{ t: T0, k: 'start', d: { stop: 'Gare du Midi' } }] });
    j.add('a', { t: at(5), k: 'arrived' });
    await j.flush();
    expect(m.stored()).not.toMatch(COORD_KEYS);
    expect(m.stored()).not.toMatch(/50\.8466|Loi 16/);
  });

  it('clés refusées : position et adresse seulement (stop, line, plat, longestGap restent)', () => {
    for (const k of ['lat', 'LAT', 'Lon', 'lng', 'Latitude', 'LONGITUDE', 'address', 'Adresse', 'ADRESSE', 'fromLat', 'to_lon', 'homeAddress', 'home_address', 'latLon', 'lat1', 'coords', 'geo']) {
      expect(refusedKey(k), k).toBe(true);
    }
    for (const k of ['stop', 'line', 'plat', 'platform', 'longestGap', 'along', 'n', 'acc', 'gap', 'm', 'id', 'on', 'connected', 'issues', 'end', 'level', 'reason', 'title', 'kind']) {
      expect(refusedKey(k), k).toBe(false);
    }
  });

  it('valeurs refusées : positions et adresses, jamais un arrêt, une gare, une heure, une voie ni un problème signalé', () => {
    for (const s of ['50.8466, 4.3528', '50.8466,4.3528', '50,8466 4,3528', '(50.8466; 4.3528)', 'POINT(4.3528 50.8466)', 'geo:50.84,4.35', '50°50′48″N 4°21′10″E', 'lat 50.84', 'lon=4.35']) {
      expect(looksLikeCoordinates(s), s).toBe(true);
    }
    for (const s of ['Rue de la Loi 16', 'rue de la Loi 16, 1000 Bruxelles', '16 rue de la Loi', 'Wetstraat 16', 'Rue Wiertz 60', 'Place Poelaert 1', 'Boulevard du Jardin Botanique 50', 'Grote Markt 1']) {
      expect(looksLikeAddress(s), s).toBe(true);
    }
    const fine = [
      'Bruxelles-Central',
      'Gare des Guillemins',
      'Vers Gare des Guillemins',
      'De Brouckère',
      'Gent-Sint-Pieters',
      'Place Flagey',
      'Avenue Louise',
      'Rue de la Loi',
      'quai 3',
      'IC 07:42 voie 6',
      'bus 71',
      'tram 3',
      'métro 2',
      'Trajet 12',
      'Bureau',
      '1000 Bruxelles',
      'Lunettes\u00a0: 12\u00a0% de batterie',
      'Position perdue depuis 3\u00a0min',
      'Pas de position\u00a0: guidage à l’heure',
      'Position «\u00a0Toujours\u00a0» pour l’appli Even, sur le téléphone',
      'Rue Neuve dans 30 m',
      'précision 12,5 m',
      'Quai 1.3.0',
      '15/11/2026 08:02:10',
      'leave:j1763190000000',
    ];
    for (const s of fine) {
      expect(looksLikeCoordinates(s), s).toBe(false);
      expect(looksLikeAddress(s), s).toBe(false);
    }
  });
});

describe('texte à copier', () => {
  it('l’en-tête « Journal Quai 1.3.0, trajet « Bureau », 15/11/2026 », puis une ligne par événement, chaque sorte en français', async () => {
    const j = await createJournal(memKV().kv);
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: T0 });
    j.add(id, { t: at(1), k: 'battery', d: { level: 12 } });
    j.add(id, { t: at(2), k: 'check', d: { issues: 'Lunettes : 12 % de batterie; Pas de position : guidage à l’heure' } });
    j.add(id, { t: at(130), k: 'moment', d: { m: 'leave', id: 'leave:j1' } });
    j.add(id, { t: at(175), k: 'remind', d: { m: 'leave', n: 1 } });
    j.add(id, { t: at(190), k: 'seen', d: { m: 'leave' } });
    j.add(id, { t: at(200), k: 'clear', d: { m: 'leave' } });
    j.add(id, { t: at(300), k: 'positions', d: { n: 58, acc: 12.5, gap: 200 } });
    j.add(id, { t: at(420), k: 'fg', d: { on: false } });
    j.add(id, { t: at(450), k: 'fg', d: { on: true } });
    j.add(id, { t: at(480), k: 'glasses', d: { connected: false } });
    j.add(id, { t: at(500), k: 'glasses', d: { connected: true } });
    j.add(id, { t: at(600), k: 'boarded', d: { line: 'bus 71' } });
    j.add(id, { t: at(900), k: 'passed', d: { stop: 'De Brouckère' } });
    j.add(id, { t: at(905), k: 'replan', d: { reason: 'passed' } });
    j.add(id, { t: at(1200), k: 'alighted', d: { stop: 'Bruxelles-Central' } });
    j.add(id, { t: at(1500), k: 'arrived' });
    j.add(id, { t: at(1501), k: 'essai', d: { x: 1.5, ok: true } });
    j.add(id, { t: at(1502), k: 'inconnu' });
    j.end(id, 'done', at(1510));
    expect(j.text(id).split('\n')).toEqual([
      `Journal Quai ${APP_VERSION}, trajet «${NB}Bureau${NB}», 15/11/2026`,
      '08:00:00 Début du guidage',
      `08:00:01 Batterie des lunettes${NB}: 12${NB}%`,
      `08:00:02 Vérification${NB}: Lunettes${NB}: 12${NB}% de batterie${NB}; Pas de position${NB}: guidage à l’heure`,
      '08:02:10 Partir maintenant affiché',
      '08:02:55 Partir maintenant renvoyé (rappel 1)',
      '08:03:10 Partir maintenant vu (tête levée)',
      '08:03:20 Partir maintenant effacé d’un toucher',
      `08:05:00 Positions${NB}: 58 reçues, précision médiane 12,5${NB}m, plus long trou 3${NB}min 20${NB}s`,
      '08:07:00 Quai quitté sur les lunettes',
      '08:07:30 Quai revenu au premier plan des lunettes',
      '08:08:00 Lunettes déconnectées',
      '08:08:20 Lunettes reconnectées',
      `08:10:00 Montée constatée${NB}: bus 71`,
      `08:15:00 Arrêt dépassé${NB}: De Brouckère`,
      `08:15:05 Recalcul du trajet${NB}: arrêt dépassé`,
      '08:20:00 Descente constatée à Bruxelles-Central',
      '08:25:00 Arrivée constatée',
      `08:25:01 essai (x${NB}: 1,5, ok${NB}: oui)`,
      '08:25:02 inconnu',
      `08:25:10 Fin du guidage${NB}: tu y es`,
    ]);
  });

  it('les moments en français (mots de l’écran quand il en a), une sorte de moment inconnue telle quelle', async () => {
    expect(JOURNAL_MOMENT_WORDS).toEqual({
      leave: 'Partir maintenant',
      turn: 'Tourner',
      board: 'Monter',
      platform: 'Voie modifiée',
      alight: 'Descends au prochain arrêt',
      replan: 'Nouveau trajet',
      passed: 'Arrêt dépassé',
      offMap: 'Hors de Belgique',
      check: 'À vérifier',
      nextStop: 'Prochain arrêt',
      arrived: 'Tu y es',
      // 1.3.1 (B17) : la marche après une descente
      walk: 'À pied',
    });
    // les mêmes mots que les écrans des lunettes
    for (const m of ['leave', 'alight', 'platform', 'arrived', 'offMap'] as const) expect(JOURNAL_MOMENT_WORDS[m]).toBe(GUIDE_TEXT[m]);
    const j = await createJournal(memKV().kv);
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: T0 });
    const names = [...Object.keys(JOURNAL_MOMENT_WORDS), 'nouveau', 'constructor'];
    names.forEach((m, i) => j.add(id, { t: at(i + 1), k: 'moment', d: { m } }));
    j.add(id, { t: at(60), k: 'moment' });
    const lines = j.text(id).split('\n').slice(2);
    expect(lines).toEqual([
      ...Object.values(JOURNAL_MOMENT_WORDS).map((w, i) => `08:00:${String(i + 1).padStart(2, '0')} ${w} affiché`),
      // 1.3.1 : le rang suit le nombre de moments (walk ajouté)
      `08:00:${String(Object.keys(JOURNAL_MOMENT_WORDS).length + 1).padStart(2, '0')} nouveau affiché`,
      `08:00:${String(Object.keys(JOURNAL_MOMENT_WORDS).length + 2).padStart(2, '0')} constructor affiché`,
      '08:01:00 Message affiché',
    ]);
  });

  it('les fins, les recalculs, « j’y descends » et les détails absents', async () => {
    const j = await createJournal(memKV().kv);
    const ends = ['done', 'stopped', 'ended', 'replaced'] as const;
    const words = ['tu y es', 'arrêté', 'trajet terminé', 'nouveau guidage'];
    ends.forEach((end, i) => {
      const id = j.begin({ title: 'Vers Gare des Guillemins', kind: 'ride', at: T0 });
      j.add(id, { t: at(1), k: 'replan', d: { reason: ['missed', 'cancelled', 'late', 'autre'][i] } });
      j.add(id, { t: at(2), k: 'battery' });
      j.add(id, { t: at(3), k: 'positions', d: { n: i === 0 ? 0 : 1 } });
      j.add(id, { t: at(4), k: 'alighted' });
      j.add(id, { t: at(5), k: 'check' });
      j.end(id, end, at(10));
      expect(j.text(id).split('\n')).toEqual([
        `Journal Quai ${APP_VERSION}, trajet «${NB}Vers Gare des Guillemins${NB}», 15/11/2026`,
        `08:00:00 Début du guidage «${NB}j’y descends${NB}»`,
        `08:00:01 Recalcul du trajet${NB}: ${['véhicule parti', 'véhicule supprimé', 'correspondance ratée', 'autre'][i]}`,
        '08:00:02 Batterie des lunettes',
        `08:00:03 Positions${NB}: ${i === 0 ? 'aucune reçue' : '1 reçue, précision inconnue'}`,
        '08:00:04 Descente constatée',
        '08:00:05 Vérification',
        `08:00:10 Fin du guidage${NB}: ${words[i]}`,
      ]);
    });
    const noName = j.begin({ title: '', kind: 'trip', at: T0 });
    expect(j.text(noName).split('\n')[0]).toBe(`Journal Quai ${APP_VERSION}, trajet sans nom, 15/11/2026`);
  });

  it('ce qu’écrit le contrôleur du guidage : start et end en plus de begin() et end(), boarded.mode, replan.found, positions sans précision, problèmes joints par « ; », « Vers une adresse »', async () => {
    const m = memKV();
    const j = await createJournal(m.kv);
    // comme GuideTrail (glasses/reminder.ts) : checkLines joints par « ; » (insécable devant)
    const issues = checkLines([{ kind: 'battery', level: 12 }, { kind: 'noPosition' }]).join(`${NB}; `);
    // GuideTrail.begin : begin(), puis l'événement start
    const id = j.begin({ title: 'Vers une adresse', kind: 'trip', at: T0 });
    j.add(id, { t: T0, k: 'start', d: { title: 'Vers une adresse', kind: 'trip' } });
    j.add(id, { t: at(1), k: 'battery', d: { level: 12 } });
    j.add(id, { t: at(2), k: 'check', d: { issues } });
    j.add(id, { t: at(130), k: 'moment', d: { m: 'leave', id: 'leave:j1a2b3' } });
    j.add(id, { t: at(300), k: 'positions', d: { n: 0, gap: 300 } });
    j.add(id, { t: at(600), k: 'positions', d: { n: 25, gap: 40 } });
    j.add(id, { t: at(660), k: 'boarded', d: { line: '71', mode: 'bus' } });
    j.add(id, { t: at(900), k: 'replan', d: { reason: 'cancelled', found: true } });
    j.add(id, { t: at(960), k: 'boarded', d: { line: 'IC', mode: 'train' } });
    j.add(id, { t: at(1200), k: 'replan', d: { reason: 'missed', found: false } });
    j.add(id, { t: at(1260), k: 'boarded' });
    j.add(id, { t: at(1500), k: 'arrived' });
    j.add(id, { t: at(1510), k: 'positions', d: { n: 3, acc: 8, gap: 12 } });
    // GuideTrail.end : l'événement end, puis end()
    j.add(id, { t: at(1511), k: 'end', d: { end: 'done' } });
    j.end(id, 'done', at(1512));
    expect(j.text(id).split('\n')).toEqual([
      `Journal Quai ${APP_VERSION}, trajet «${NB}Vers une adresse${NB}», 15/11/2026`,
      '08:00:00 Début du guidage',
      `08:00:01 Batterie des lunettes${NB}: 12${NB}%`,
      `08:00:02 Vérification${NB}: ${issues}`,
      '08:02:10 Partir maintenant affiché',
      `08:05:00 Positions${NB}: aucune reçue, plus long trou 5${NB}min`,
      `08:10:00 Positions${NB}: 25 reçues, précision inconnue, plus long trou 40${NB}s`,
      `08:11:00 Montée constatée${NB}: bus 71`,
      `08:15:00 Recalcul du trajet${NB}: véhicule supprimé, nouveau trajet trouvé`,
      `08:16:00 Montée constatée${NB}: IC`,
      `08:20:00 Recalcul du trajet${NB}: véhicule parti, pas d’autre trajet trouvé`,
      '08:21:00 Montée constatée',
      '08:25:00 Arrivée constatée',
      `08:25:10 Positions${NB}: 3 reçues, précision médiane 8${NB}m, plus long trou 12${NB}s`,
      `08:25:11 Fin du guidage${NB}: tu y es`,
    ]);
    expect(issues).toContain(`batterie${NB}; Pas de position`);
    expect(j.list()[0]).toMatchObject({ title: 'Vers une adresse', end: 'done', endedAt: at(1511) });
    expect(j.list()[0].events.filter((e) => e.k === 'start' || e.k === 'end')).toHaveLength(2);
    await j.flush();
    expect(JSON.parse(m.stored()!).trips[0].title).toBe('Vers une adresse');
  });

  it('le véhicule monté comme sur les lunettes : bus, tram, métro, train (sa catégorie), bus de remplacement, mode inconnu', async () => {
    const j = await createJournal(memKV().kv);
    const id = j.begin({ title: 'Bureau', kind: 'trip', at: T0 });
    const cases: [Record<string, string>, string][] = [
      [{ line: '71', mode: 'bus' }, 'bus 71'],
      [{ line: '92', mode: 'tram' }, 'tram 92'],
      [{ line: '2', mode: 'metro' }, 'métro 2'],
      [{ line: 'IC', mode: 'train' }, 'IC'],
      [{ line: 'S1', mode: 'train' }, 'S1'],
      [{ mode: 'train' }, 'train'],
      [{ line: 'BUS', mode: 'bus' }, 'bus'],
      [{ mode: 'tram' }, 'tram'],
      [{ line: 'bus 71', mode: 'bus' }, 'bus 71'],
      [{ line: 'W' }, 'W'],
      [{ line: '3', mode: 'bateau' }, 'bateau 3'],
    ];
    cases.forEach(([d], i) => j.add(id, { t: at(i + 1), k: 'boarded', d }));
    expect(j.text(id).split('\n').slice(2)).toEqual(cases.map(([, v], i) => `08:00:${String(i + 1).padStart(2, '0')} Montée constatée${NB}: ${v}`));
  });

  it('typographie : insécables, jamais de tiret long ni moyen, une ligne par événement', async () => {
    const j = await createJournal(memKV().kv);
    const id = j.begin({ title: 'Gare \u2014 Midi', kind: 'trip', at: T0 });
    j.add(id, { t: at(1), k: 'passed', d: { stop: 'Bruxelles\u2013Midi' } });
    j.add(id, { t: at(2), k: 'check', d: { issues: 'Lunettes : 9 % de batterie ; Position perdue depuis 3 min' } });
    j.add(id, { t: at(3), k: 'alighted', d: { stop: 'Gare\ndu Midi' } });
    j.add(id, { t: at(4), k: 'essai ?', d: { note: 'vraiment ?' } });
    j.add(id, { t: at(5), k: 'check', d: { issues: 'Position « Toujours » pour l’appli Even' } });
    const text = j.text(id);
    expect(text).toContain(`Position «${NB}Toujours${NB}» pour l’appli Even`);
    expect(text).not.toMatch(/[\u2014\u2013]/);
    expect(text).not.toMatch(/ [:;!?»]/);
    expect(text).not.toMatch(/«(?!\u00a0)/);
    expect(text).not.toMatch(/\d [%]|\d (?:min|m|s)\b/);
    expect(text.split('\n')).toHaveLength(7);
    expect(text).toContain(`Arrêt dépassé${NB}: Bruxelles-Midi`);
    expect(text).toContain('trajet «\u00a0Gare, Midi\u00a0»');
  });

  it('heures de Bruxelles : hiver UTC+1, été UTC+2, date du jour à Bruxelles, quel que soit le fuseau du téléphone', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Pacific/Auckland';
    try {
      const j = await createJournal(memKV().kv);
      // 15/07/2026 00:30 à Bruxelles (14/07 22:30 UTC)
      const summer = j.begin({ title: 'Bureau', kind: 'trip', at: Date.UTC(2026, 6, 14, 22, 30, 0) });
      j.add(summer, { t: Date.UTC(2026, 6, 15, 6, 2, 10), k: 'moment', d: { m: 'leave' } });
      expect(j.text(summer).split('\n')).toEqual([`Journal Quai ${APP_VERSION}, trajet «${NB}Bureau${NB}», 15/07/2026`, '00:30:00 Début du guidage', '08:02:10 Partir maintenant affiché']);
      // 15/11/2026 00:30 à Bruxelles (14/11 23:30 UTC)
      const winter = j.begin({ title: 'Bureau', kind: 'trip', at: Date.UTC(2026, 10, 14, 23, 30, 0) });
      j.add(winter, { t: Date.UTC(2026, 10, 15, 7, 2, 10), k: 'moment', d: { m: 'leave' } });
      expect(j.text(winter).split('\n')).toEqual([`Journal Quai ${APP_VERSION}, trajet «${NB}Bureau${NB}», 15/11/2026`, '00:30:00 Début du guidage', '08:02:10 Partir maintenant affiché']);
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('heure d’été : les deux changements d’heure de 2026 (29/03 et 25/10)', async () => {
    const j = await createJournal(memKV().kv);
    // printemps : à 02:00 il est 03:00
    const spring = j.begin({ title: 'Gare du Midi', kind: 'trip', at: Date.UTC(2026, 2, 29, 0, 59, 59) });
    j.add(spring, { t: Date.UTC(2026, 2, 29, 1, 0, 0), k: 'arrived' });
    expect(j.text(spring).split('\n')).toEqual([`Journal Quai ${APP_VERSION}, trajet «${NB}Gare du Midi${NB}», 29/03/2026`, '01:59:59 Début du guidage', '03:00:00 Arrivée constatée']);
    // automne : à 03:00 il est 02:00
    const autumn = j.begin({ title: 'Gare du Midi', kind: 'trip', at: Date.UTC(2026, 9, 25, 0, 59, 59) });
    j.add(autumn, { t: Date.UTC(2026, 9, 25, 1, 0, 0), k: 'arrived' });
    expect(j.text(autumn).split('\n')).toEqual([`Journal Quai ${APP_VERSION}, trajet «${NB}Gare du Midi${NB}», 25/10/2026`, '02:59:59 Début du guidage', '02:00:00 Arrivée constatée']);
  });
});

describe('branchement dans l’appli', () => {
  const read = (p: string): string => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');
  const block = (src: string, start: string): string => {
    const i = src.indexOf(start);
    expect(i, start).toBeGreaterThan(0);
    return src.slice(i, src.indexOf('});', i));
  };

  // contrôle technique (point 1) : le journal n'est plus jamais attendu au démarrage ; il s'ouvre en arrière-plan une fois
  // l'écran d'ouverture affiché, et le contrôleur (attachJournal) et le téléphone le reçoivent dès qu'il est prêt
  it.each([
    ['main.ts', './core/journal'],
    ['web/main.ts', '../core/journal'],
  ])('%s : journal ouvert sur platform.kv en arrière-plan après le démarrage, jamais attendu, donné au contrôleur et au téléphone dès qu’il est prêt', (file, from) => {
    const src = read(file);
    expect(src).toContain(`import { createJournal, type JournalStore } from '${from}';`);
    // aucune attente : ni await du journal, ni journal donné à la création du contrôleur
    expect(src).not.toMatch(/await[^;\n]*(createJournal|journalReady)/);
    expect(src).not.toContain('journalReady');
    expect(block(src, 'new GlassesController({')).not.toMatch(/journal/);
    // null pour le téléphone tant qu'il n'est pas prêt
    const slot = src.indexOf('let journal: JournalStore | null = null;');
    expect(slot).toBeGreaterThan(0);
    expect(slot).toBeLessThan(src.indexOf('mountPhone({'));
    expect(block(src, 'mountPhone({')).toMatch(/\n\s*journal: \(\) => journal,\n/);
    // ouvert après le démarrage des lunettes (sa lecture ne passe pas devant les leurs dans la file du pont), en arrière-plan
    const start = src.indexOf('await controller.start();');
    const open = src.search(/void createJournal\(platform\.kv, \{ now: clock\.now \}\)\.then\(\s*\(j\) => \{\s*journal = j;\s*controller\.attachJournal\(j\);\s*\},\s*\(e: unknown\) => console\.warn\('\[Quai\] journal des trajets indisponible', e\),\s*\);/);
    expect(start).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(start);
    expect(src.match(/createJournal\(/g)).toHaveLength(1);
    // enregistré tout de suite quand la page se cache ou se ferme
    expect(src).toMatch(/window\.addEventListener\('pagehide', saveJournal\)/);
    expect(src).toMatch(/visibilityState === 'hidden' && saveJournal\(\)/);
  });
});
