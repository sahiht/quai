/**
 * Quai 1.3.0, corrections du contrôle technique, point 2 : journal écrasé après une lecture ratée. Le pont de l'appli Even
 * rend '' au bout de 5 s sans réponse et createKV gardait ce vide : un journal plein était remplacé par un seul trajet.
 * Le journal lit maintenant avec la lecture stricte (KV.getStrict) : lecture ratée, rien n'est écrit tant qu'une lecture
 * n'a pas réussi ; nouvel essai au premier begin(), puis à chaque enregistrement ; trajets de la session fusionnés avec
 * ceux relus, par identifiant, plafonds respectés. Vrai chemin de l'appli Even (bridgeStorage, file du pont, createKV)
 * pour le constat, un support réglable ensuite. Lieux publics seulement.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KV } from '../../src/core/api';
import { JOURNAL_KEY, JOURNAL_MAX_TRIPS, JOURNAL_PENDING_MAX, JOURNAL_SAVE_MS, createJournal } from '../../src/core/journal';
import type { JournalTrip } from '../../src/core/journal-types';
import { bridgeStorage } from '../../src/platform/even';
import { createKV, type KVBackend } from '../../src/platform/kv';
import { SerialQueue } from '../../src/platform/queue';

/** 15/11/2026 08:00:00 à Bruxelles. */
const T0 = Date.UTC(2026, 10, 15, 7, 0, 0);
const at = (sec: number): number => T0 + sec * 1000;
const HOUR = 3600;

/** Journal enregistré : `n` trajets, un par heure la veille, entre des gares publiques ; finis sauf `open` (en cours). */
function storedJournal(n: number, open: number[] = []): string {
  const trips: JournalTrip[] = Array.from({ length: n }, (_, i) => {
    const start = at(-24 * HOUR + i * HOUR);
    const t: JournalTrip = { id: `j-veille-${i + 1}`, title: `Gare du Midi ${i + 1}`, kind: 'trip', startedAt: start, events: [{ t: start, k: 'start', d: { title: `Gare du Midi ${i + 1}`, kind: 'trip' } }] };
    if (open.includes(i + 1)) return t;
    return { ...t, endedAt: start + 1_200_000, end: 'done', events: [...t.events, { t: start + 1_200_000, k: 'end', d: { end: 'done' } }] };
  });
  return JSON.stringify({ v: 1, trips });
}

/** Support du téléphone en mémoire dont les lectures peuvent rester sans réponse (`mute`) ; chaque écriture gardée. */
function phone(init?: string) {
  const data = new Map<string, string>();
  if (init !== undefined) data.set(JOURNAL_KEY, init);
  let mute = false;
  let reads = 0;
  const writes: string[] = [];
  const backend: KVBackend = {
    async get(k) {
      return mute ? '' : (data.get(k) ?? null);
    },
    async getStrict(k) {
      reads++;
      if (mute) throw new Error('stockage du téléphone sans réponse');
      return data.get(k) ?? null;
    },
    async set(k, v) {
      writes.push(v);
      data.set(k, v);
    },
  };
  return {
    kv: createKV(backend),
    writes,
    reads: () => reads,
    mute: (on: boolean) => (mute = on),
    stored: (): { v: number; trips: JournalTrip[] } => JSON.parse(data.get(JOURNAL_KEY)!),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('point 2 : une lecture ratée n’écrase jamais le journal', () => {
  it('constat sur le vrai chemin de l’appli Even : le pont ne répond pas à l’ouverture, un trajet guidé ensuite ; le journal plein reste, puis reçoit le trajet', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers({ now: at(0) });
    const store = new Map<string, string>([[JOURNAL_KEY, storedJournal(6)]]);
    let mute = true;
    const writes: string[] = [];
    const bridge = {
      getLocalStorage: (k: string) => (mute ? new Promise<string>(() => undefined) : Promise.resolve(store.get(k) ?? '')),
      setLocalStorage: async (k: string, v: string) => {
        writes.push(k);
        store.set(k, v);
        return true;
      },
    };
    const kv = createKV(bridgeStorage(bridge, new SerialQueue(4000)));
    const opening = createJournal(kv, { now: () => Date.now() });
    await vi.advanceTimersByTimeAsync(5_100);
    const j = await opening;
    // sans la correction : journal vide, puis remplacé par ce seul trajet au premier enregistrement
    expect(j.list()).toEqual([]);
    const id = j.begin({ title: 'Bruxelles-Central', kind: 'trip', at: at(10) });
    j.add(id, { t: at(70), k: 'moment', d: { m: 'leave', id: 'leave:j1' } });
    await vi.advanceTimersByTimeAsync(5_100 + JOURNAL_SAVE_MS + 5_100);
    expect(writes).toEqual([]);
    expect(JSON.parse(store.get(JOURNAL_KEY)!).trips).toHaveLength(6);
    // le pont répond de nouveau : l'enregistrement suivant relit, fusionne, écrit
    mute = false;
    j.end(id, 'done', at(1500));
    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toEqual([JOURNAL_KEY]);
    const saved = JSON.parse(store.get(JOURNAL_KEY)!).trips as JournalTrip[];
    expect(saved.map((t) => t.title)).toEqual([...Array.from({ length: 6 }, (_, i) => `Gare du Midi ${i + 1}`), 'Bruxelles-Central']);
    expect(saved[6].events.map((e) => e.k)).toEqual(['start', 'moment', 'end']);
    expect(j.list().map((t) => t.title)[0]).toBe('Bruxelles-Central');
  });

  it('lecture ratée à l’ouverture, réussie au premier begin() : fusion tout de suite, un seul enregistrement', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = phone(storedJournal(3));
    p.mute(true);
    const j = await createJournal(p.kv);
    expect(p.reads()).toBe(1);
    p.mute(false);
    const id = j.begin({ title: 'Gare des Guillemins', kind: 'ride', at: at(0) });
    await j.flush();
    expect(p.reads()).toBe(2);
    expect(p.writes).toHaveLength(1);
    expect(p.stored().trips.map((t) => t.id)).toEqual(['j-veille-1', 'j-veille-2', 'j-veille-3', id]);
  });

  it('toujours sans réponse : chaque enregistrement relit d’abord, rien n’est écrit ; les trajets de la session restent lisibles', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers({ now: at(0) });
    const p = phone(storedJournal(2));
    p.mute(true);
    const j = await createJournal(p.kv);
    const a = j.begin({ title: 'Gare du Nord', kind: 'trip', at: at(0) });
    await vi.advanceTimersByTimeAsync(0);
    j.add(a, { t: at(30), k: 'boarded', d: { line: 'IC' } });
    await vi.advanceTimersByTimeAsync(JOURNAL_SAVE_MS);
    j.end(a, 'done', at(900));
    await vi.advanceTimersByTimeAsync(0);
    await j.flush();
    // ouverture, puis begin, l'événement regroupé, la fin, flush : une lecture à chaque fois, aucune écriture
    expect(p.reads()).toBe(5);
    expect(p.writes).toEqual([]);
    expect(j.list().map((t) => [t.title, t.end])).toEqual([['Gare du Nord', 'done']]);
    expect(j.text(a)).toContain('Montée constatée');
    // sans nouvel enregistrement, rien ne relit tout seul
    await vi.advanceTimersByTimeAsync(10 * JOURNAL_SAVE_MS);
    expect(p.reads()).toBe(5);
  });

  it('guidage repris pendant une lecture ratée (trajet déjà enregistré) : ses événements et sa fin rejoignent son trajet à la relecture', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = phone(storedJournal(2, [1]));
    expect(p.stored().trips[0].end).toBeUndefined();
    p.mute(true);
    const j = await createJournal(p.kv);
    // le contrôleur continue le trajet j-veille-1 (identifiant gardé avec le guidage)
    j.add('j-veille-1', { t: at(10), k: 'fg', d: { on: true } });
    j.add('j-veille-1', { t: at(20), k: 'arrived' });
    j.end('j-veille-1', 'done', at(30));
    // un trajet inconnu du journal relu : oublié
    j.add('j-inconnu', { t: at(15), k: 'arrived' });
    expect(j.list()).toEqual([]);
    await j.flush();
    expect(p.writes).toEqual([]);
    p.mute(false);
    await j.flush();
    expect(p.writes).toHaveLength(1);
    const first = p.stored().trips[0];
    expect(first).toMatchObject({ id: 'j-veille-1', end: 'done', endedAt: at(30) });
    expect(first.events.map((e) => e.k)).toEqual(['start', 'fg', 'arrived', 'end']);
    expect(p.stored().trips.map((t) => t.id)).toEqual(['j-veille-1', 'j-veille-2']);
    // gardés en attendant : JOURNAL_PENDING_MAX événements au plus
    expect(JOURNAL_PENDING_MAX).toBe(500);
  });

  it('fusion : plafonds respectés (10 trajets, les plus anciens oubliés d’abord), aucun doublon', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = phone(storedJournal(9));
    p.mute(true);
    const j = await createJournal(p.kv);
    const ids = [j.begin({ title: 'Namur', kind: 'trip', at: at(0) }), j.begin({ title: 'Louvain-la-Neuve', kind: 'trip', at: at(60) }), j.begin({ title: 'Mons', kind: 'trip', at: at(120) })];
    await j.flush();
    expect(p.writes).toEqual([]);
    p.mute(false);
    await j.flush();
    const kept = p.stored().trips.map((t) => t.id);
    expect(kept).toHaveLength(JOURNAL_MAX_TRIPS);
    expect(kept).toEqual([...Array.from({ length: 7 }, (_, i) => `j-veille-${i + 3}`), ...ids]);
    expect(new Set(kept).size).toBe(kept.length);
    expect(j.list().map((t) => t.id)).toEqual(kept.slice().reverse());
  });

  it('« Effacer le journal » pendant une lecture ratée : le journal vide est écrit, rien ne revient ensuite', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = phone(storedJournal(4));
    p.mute(true);
    const j = await createJournal(p.kv);
    j.begin({ title: 'Gare du Midi', kind: 'trip', at: at(0) });
    j.clear();
    await j.flush();
    expect(p.stored()).toEqual({ v: 1, trips: [] });
    p.mute(false);
    const id = j.begin({ title: 'Ottignies', kind: 'trip', at: at(60) });
    await j.flush();
    expect(p.stored().trips.map((t) => t.id)).toEqual([id]);
  });

  it('stockage sans lecture stricte : la lecture simple, comme avant (le journal s’ouvre et enregistre)', async () => {
    const data = new Map<string, string>([[JOURNAL_KEY, storedJournal(1)]]);
    const kv: KV = { get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v) };
    const j = await createJournal(kv);
    expect(j.list().map((t) => t.id)).toEqual(['j-veille-1']);
    j.begin({ title: 'Liège-Guillemins', kind: 'trip', at: at(0) });
    await j.flush();
    expect(JSON.parse(data.get(JOURNAL_KEY)!).trips).toHaveLength(2);
  });
});
