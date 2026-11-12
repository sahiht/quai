// @vitest-environment happy-dom
/**
 * Quai Web, rubrique « Position » (PRD-1.2 § 3, CA-3.1) : le champ unique du téléphone (lieux, adresses récentes,
 * adresses, gares et arrêts), ses textes, la position choisie gardée dans le navigateur, la panne du service
 * d'adresses.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Core, FavoritePlace } from '../../src/core/api';
import { createWebLocation, MANUAL_KEY } from '../../src/web/location';
import { manualOf, positionCard } from '../../src/web/position';
import { button, defaults, harness, mount, options, textOf, type, until } from '../phone/helpers';

afterEach(() => document.body.replaceChildren());

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
type Ok = (p: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void;
type Err = (e: { code: number }) => void;
const refused = { getCurrentPosition: (_ok: Ok, err: Err) => err({ code: 1 }) };
const granted = { getCurrentPosition: (ok: Ok) => ok({ coords: { latitude: 50.86, longitude: 4.359, accuracy: 20 } }) };

const BUREAU: FavoritePlace = { kind: 'place', id: 'fav-bureau', label: 'Bureau', lat: 50.8441, lon: 4.3474, address: 'Rue de la Loi 1, 1000 Bruxelles', src: 'address', propose: 'morning' };

async function setup(opts: { geo?: typeof refused | typeof granted; flags?: { geo?: 'down' }; withPlace?: boolean } = {}) {
  const calls: string[] = [];
  const hz = harness({
    settings: defaults(opts.withPlace ? { favorites: [BUREAU], recent: [{ label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 1 }] } : {}),
    flags: opts.flags,
    // seul le texte tapé (et la langue) part : la position ne sert qu'au tri, dans le cœur
    core: (c: Core) => ({ ...c, geocode: (q, lang, near) => (calls.push(q), c.geocode(q, lang, near)) }),
  });
  const store = memStore();
  const loc = createWebLocation(() => 1_000, { geo: opts.geo ?? refused, secure: true, store, permissions: null });
  await loc.current(100);
  let changed = 0;
  const card = mount(positionCard({ location: loc, core: hz.ctx.core, settings: hz.settings, changed: () => void changed++, id: 'w-pos', now: () => 42 }));
  const input = card.querySelector<HTMLInputElement>('#w-pos-q')!;
  return { hz, store, loc, card, input, calls, changed: () => changed };
}

describe('rubrique « Position » de Quai Web (PRD-1.2 § 3)', () => {
  it('CA-3.1 : position refusée, « rue de fer 25 namur », « Position choisie : Rue de Fer 25. » gardée dans ce navigateur', async () => {
    const { hz, store, loc, card, input, calls, changed } = await setup();
    expect(textOf(card.querySelector('.w-pos-status'))).toMatch(/Ou choisis une adresse ou un arrêt ci-dessous\.$/);
    expect(textOf(card.querySelector('label[for="w-pos-q"]'))).toBe('Choisir une adresse, une gare ou un arrêt');
    expect(input.placeholder).toBe('Adresse, gare ou arrêt');
    expect(textOf(card.querySelector('.privacy'))).toBe('Adresses : services officiels des Régions bruxelloise, flamande et wallonne. Seul le texte tapé leur est envoyé.');
    type(input, 'rue de fer 25 namur');
    await until(() => options(card.querySelector('.suggest')!).some(([l]) => l === 'Rue de Fer 25, 5000 Namur'));
    expect(calls.at(-1)).toBe('rue de fer 25 namur');
    button(card, /^Rue de Fer 25, 5000 Namur/).click();
    expect(textOf(card.querySelector('.w-pos-status'))).toBe('Position choisie : Rue de Fer 25. Gardée dans ce navigateur.');
    expect(card.querySelector<HTMLElement>('.w-pos-field')!.hidden).toBe(true);
    expect(changed()).toBe(1);
    // « Autour de moi » est centré là
    expect(loc.last()).toMatchObject({ lat: 50.4662, lon: 4.8648, source: 'manual' });
    // gardée au rechargement
    expect(JSON.parse(store.getItem(MANUAL_KEY)!)).toEqual({ lat: 50.4662, lon: 4.8648, label: 'Rue de Fer 25' });
    expect(createWebLocation(() => 1_000, { geo: refused, secure: true, store, permissions: null }).state()).toEqual({ kind: 'manual', label: 'Rue de Fer 25' });
    // l'adresse devient récente (S4), comme sur le téléphone
    await until(() => hz.settings.get().recent[0]?.label === 'Rue de Fer 25, 5000 Namur');
    // liens : « Choisir un autre endroit », puis retour au navigateur
    expect(textOf(card.querySelector('.w-pos-pick'))).toBe('Choisir un autre endroit');
  });

  it('lieux d’abord, puis adresses récentes ; un lieu, une rue sans numéro, un arrêt', async () => {
    const { card, input, loc } = await setup({ withPlace: true });
    input.focus();
    input.dispatchEvent(new Event('focus'));
    await until(() => options(card.querySelector('.suggest')!).length >= 2);
    expect(options(card.querySelector('.suggest')!)).toEqual([
      ['Bureau', 'favori'],
      ['Veldstraat 1, 9000 Gent', 'récent'],
    ]);
    button(card, /^Bureau/).click();
    expect(textOf(card.querySelector('.w-pos-status'))).toBe('Position choisie : Bureau. Gardée dans ce navigateur.');
    expect(loc.last()).toMatchObject({ lat: 50.8441, lon: 4.3474 });
    expect(manualOf({ kind: 'address', label: 'Rue Neuve, 1000 Bruxelles', lat: 50.852, lon: 4.3555, approx: true, recent: false })).toEqual({ lat: 50.852, lon: 4.3555, label: 'Rue Neuve (sans numéro)' });
    expect(manualOf({ kind: 'address', label: 'Rue Neuve 1, 1000 Bruxelles', lat: 50.8505, lon: 4.3545, approx: true, recent: false })!.label).toBe('Rue Neuve 1');
    expect(manualOf({ kind: 'here', label: 'Ma position' })).toBeNull();
  });

  it('une gare : « Namur (gare SNCB) » ; position du navigateur : lien « Choisir une adresse ou un arrêt à la place »', async () => {
    const { card, input } = await setup({ geo: granted });
    expect(textOf(card.querySelector('.w-pos-status'))).toBe('Position du navigateur, précise à 20 m.');
    expect(card.querySelector<HTMLElement>('.w-pos-field')!.hidden).toBe(true);
    const pick = card.querySelector<HTMLButtonElement>('.w-pos-pick')!;
    expect(textOf(pick)).toBe('Choisir une adresse ou un arrêt à la place');
    pick.click();
    expect(card.querySelector<HTMLElement>('.w-pos-field')!.hidden).toBe(false);
    type(input, 'namur');
    await until(() => options(card.querySelector('.suggest')!).some(([l, t]) => l === 'Namur' && t === 'gare SNCB'));
    card.querySelectorAll<HTMLButtonElement>('.suggest button').forEach((b) => {
      if (textOf(b.querySelector('.s1')) === 'Namur' && textOf(b.querySelector('.s2')) === 'gare SNCB') b.click();
    });
    expect(textOf(card.querySelector('.w-pos-status'))).toBe('Position choisie : Namur (gare SNCB). Gardée dans ce navigateur.');
  });

  it('service d’adresses en panne : gares et arrêts seulement', async () => {
    const { card, input } = await setup({ flags: { geo: 'down' } });
    type(input, 'namur');
    await until(() => textOf(card.querySelector('.field-note')) !== '');
    expect(textOf(card.querySelector('.field-note'))).toBe('Adresses indisponibles pour l’instant : gares et arrêts seulement.');
    expect(options(card.querySelector('.suggest')!).some(([, t]) => t === 'gare SNCB')).toBe(true);
    expect(options(card.querySelector('.suggest')!).some(([, t]) => t === 'adresse')).toBe(false);
  });
});
