// @vitest-environment happy-dom
/**
 * Champ unique (PRD M4, § 6.2, § 6.3) : ordre des propositions et leur type, adresses d'abord quand le texte
 * ressemble à une adresse, limites (4 adresses, 6 gares ou arrêts), adresses après 3 caractères et 250 ms sans
 * frappe, états (service en panne, hors ligne, rien trouvé, aide de saisie), choix écrit dans le champ.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeocodeAnswer } from '../../src/core/api';
import { GEO_DELAY_MS, MAX_ADDRESSES, MAX_STOPS, placeField, type FieldChoice } from '../../src/phone/field';
import { looksLikeAddress } from '../../src/phone/text';
import { defaults, harness, mount, options, preset, settle, sleep, textOf, type, until } from './helpers';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup(opts: Parameters<typeof harness>[0] = {}, field: Partial<Parameters<typeof placeField>[1]> = {}) {
  const hz = harness(opts);
  const picks: FieldChoice[] = [];
  const f = placeField(hz.ctx, { id: 'f', label: 'Arrivée', here: true, places: true, recent: true, onPick: (c) => picks.push(c), ...field });
  mount(f.el);
  return { ...hz, f, picks };
}

/** Tape puis attend les gares et arrêts et les adresses. */
async function search(f: ReturnType<typeof placeField>, text: string): Promise<void> {
  type(f.input, text);
  await sleep(GEO_DELAY_MS + 60);
  await settle();
}

describe('texte qui ressemble à une adresse (M4.2)', () => {
  it('un chiffre ou un mot de rue, en français ou en néerlandais', () => {
    for (const q of ['rue de fer 25 namur', 'rue neuve bruxelles', 'Av. Louise', 'chaussée de Bruxelles', 'Chée de Wavre', 'boulevard du Centenaire', 'bd Anspach', 'Place Flagey', 'quai des Usines', 'drève de Lorraine', 'allée verte', 'Veldstraat', 'Kerkstraat 3', 'Frankrijklei', 'Brusselsesteenweg', 'Sint-Pietersplein', 'Hoogweg', 'Boomlaan', 'veldstraat 1 gent']) {
      expect(looksLikeAddress(q), q).toBe(true);
    }
    for (const q of ['namur', 'gand', 'gare du midi', 'aéroport', 'lln', 'rogier', 'Korenmarkt', 'Saint-Gilles']) expect(looksLikeAddress(q), q).toBe(false);
  });
});

describe('propositions du champ unique', () => {
  it('au focus : « Ma position », mes lieux (favoris lieux), puis les adresses récentes, chacun avec son type', async () => {
    const s = preset();
    s.recent = [{ label: 'Veldstraat 1, 9000 Gent', lat: 51.0537, lon: 3.7225, at: 1 }];
    const { f } = setup({ settings: s });
    f.input.focus();
    await settle();
    // préréglage 1.0 migré : les lieux dans l'ordre de « Mes favoris »
    expect(options(f.list)).toEqual([
      ['Ma position', 'position actuelle'],
      ['Bureau', 'mon lieu'],
      ['Maison', 'mon lieu'],
      ['Veldstraat 1, 9000 Gent', 'récent'],
    ]);
    expect(f.list.getAttribute('role')).toBe('listbox');
    expect(f.input.getAttribute('role')).toBe('combobox');
    expect(f.input.getAttribute('aria-expanded')).toBe('true');
    expect(f.input.getAttribute('aria-controls')).toBe(f.list.id);
  });

  it('« namur » : la gare d’abord, puis les arrêts, puis les adresses (CA-M4.2)', async () => {
    const { f } = setup({ settings: defaults() });
    await search(f, 'namur');
    const opts = options(f.list);
    expect(opts[0]).toEqual(['Namur', 'gare SNCB']);
    const kinds = opts.map(([, t]) => t);
    const firstAddress = kinds.indexOf('adresse');
    const lastStop = Math.max(...kinds.map((k, i) => (k !== 'adresse' ? i : -1)));
    if (firstAddress >= 0) expect(firstAddress).toBeGreaterThan(lastStop);
    expect(kinds.filter((k) => k !== 'adresse').length).toBeLessThanOrEqual(MAX_STOPS);
  });

  it('« rue de fer 25 namur » : l’adresse normalisée en tête, avec le type « adresse » (CA-M4.1, F2)', async () => {
    const { f } = setup({ settings: defaults() });
    const t0 = Date.now();
    await search(f, 'rue de fer 25 namur');
    await until(() => options(f.list).some(([, t]) => t === 'adresse'));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(options(f.list)[0]).toEqual(['Rue de Fer 25, 5000 Namur', 'adresse']);
  });

  it('« rue de fer 25 » : les deux communes sont proposées (F2-b) ; au plus 4 adresses', async () => {
    const { f } = setup({ settings: defaults() });
    await search(f, 'rue de fer 25');
    const addresses = options(f.list).filter(([, t]) => t === 'adresse').map(([l]) => l);
    expect(addresses).toEqual(expect.arrayContaining(['Rue de Fer 25, 5000 Namur', 'Rue de Fer 25, 4000 Liège']));
    expect(addresses.length).toBeLessThanOrEqual(MAX_ADDRESSES);
  });

  it('rue sans numéro : « (sans numéro) » dans la proposition, position approximative au choix (F2-c)', async () => {
    const { f, picks } = setup({ settings: defaults() });
    await search(f, 'rue neuve bruxelles');
    await until(() => options(f.list).some(([l]) => l === 'Rue Neuve, 1000 Bruxelles (sans numéro)'));
    const btn = [...f.list.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((b) => textOf(b).startsWith('Rue Neuve, 1000 Bruxelles (sans numéro)'))!;
    btn.click();
    expect(picks.at(-1)).toMatchObject({ kind: 'address', label: 'Rue Neuve, 1000 Bruxelles', approx: true });
    expect(f.input.value).toBe('Rue Neuve, 1000 Bruxelles');
  });

  it('au plus 4 adresses et 6 gares ou arrêts, même si le service en rend plus', async () => {
    const many: GeocodeAnswer = { results: Array.from({ length: 8 }, (_, i) => ({ label: `Rue ${i + 1}, 1000 Bruxelles`, lat: 50.85, lon: 4.35, kind: 'adresse' as const, source: 'bru' as const, score: 1 })) };
    const { f } = setup({ settings: defaults(), core: (c) => ({ ...c, geocode: async () => many, search: async () => Array.from({ length: 10 }, (_, i) => ({ id: `stib:${i}`, op: 'stib' as const, n: { fr: `Arrêt ${i}`, nl: `Halte ${i}` }, modes: ['bus' as const], lat: 50.85, lon: 4.35, kindLabel: 'bus STIB' })) }) });
    await search(f, 'rue 1');
    const kinds = options(f.list).map(([, t]) => t);
    expect(kinds.filter((k) => k === 'adresse')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'bus STIB')).toHaveLength(6);
    // le texte contient un chiffre : les adresses d'abord
    expect(kinds.slice(0, 4)).toEqual(['adresse', 'adresse', 'adresse', 'adresse']);
  });

  it('adresses : 3 caractères au moins, après 250 ms sans frappe ; les gares et arrêts tout de suite', async () => {
    const hz = setup({ settings: defaults() });
    const geo = vi.spyOn(hz.core, 'geocode');
    const search = vi.spyOn(hz.core, 'search');
    type(hz.f.input, 'ga');
    await sleep(GEO_DELAY_MS + 60);
    expect(geo).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledWith('ga', expect.anything());
    type(hz.f.input, 'gan');
    await sleep(100);
    type(hz.f.input, 'gand');
    await settle();
    expect(geo).not.toHaveBeenCalled();
    expect(options(hz.f.list)[0]).toEqual(['Gand-Saint-Pierre', 'gare SNCB']);
    await sleep(GEO_DELAY_MS + 60);
    expect(geo).toHaveBeenCalledTimes(1);
    expect(geo.mock.calls[0][0]).toBe('gand');
  });

  it('seul le texte tapé part vers le service d’adresses (la position sert au tri, sur le téléphone)', async () => {
    const hz = setup({ settings: defaults() });
    const geo = vi.spyOn(hz.core, 'geocode');
    await search(hz.f, 'veldstraat 1 gent');
    expect(geo).toHaveBeenCalledTimes(1);
    const [q, lang] = geo.mock.calls[0];
    expect(q).toBe('veldstraat 1 gent');
    expect(lang).toBe('fr');
  });
});

describe('états du champ (§ 6.3)', () => {
  it('service d’adresses en panne : gares et arrêts restent, avec le message (CA-M4.6)', async () => {
    const { f } = setup({ settings: defaults(), flags: { geo: 'down' } });
    await search(f, 'namur');
    expect(options(f.list)[0]).toEqual(['Namur', 'gare SNCB']);
    expect(textOf(f.status)).toBe('Adresses indisponibles pour l’instant : gares et arrêts seulement.');
    expect(f.status.textContent).toContain(' :');
  });

  it('téléphone hors ligne : « Recherche d’adresse impossible sans connexion… » (CA-M4.6)', async () => {
    const { f } = setup({ settings: defaults(), flags: { offline: true } });
    await search(f, 'rue de fer 25 namur');
    expect(textOf(f.status)).toBe('Recherche d’adresse impossible sans connexion : gares et arrêts seulement.');
  });

  it('rien ne correspond (CA-M4.7)', async () => {
    const { f } = setup({ settings: defaults() });
    await search(f, 'zzqxw');
    await until(() => textOf(f.status) !== '' && !textOf(f.status).startsWith('Pour une adresse'));
    expect(options(f.list)).toEqual([]);
    expect(f.list.hidden).toBe(true);
    expect(textOf(f.status)).toBe('Aucune adresse, gare ou arrêt ne correspond. Ajoute la commune, ou vérifie l’orthographe.');
  });

  it('aide de saisie : pas de chiffre ni de mot de rue, 3 lettres ou plus, aucun arrêt (T2)', async () => {
    const one = { label: 'Boondael, 1050 Ixelles', lat: 50.81, lon: 4.38, kind: 'lieu' as const, source: 'bru' as const, score: 0.6 };
    const { f } = setup({ settings: defaults(), core: (c) => ({ ...c, geocode: async () => ({ results: [one] }) }) });
    type(f.input, 'boondael');
    await settle();
    expect(textOf(f.status)).toBe('Pour une adresse, ajoute la rue et le numéro.');
  });
});

describe('le choix s’écrit dans le champ (M4.1, CA-M4.12)', () => {
  it('« Bureau » choisi : le champ affiche « Bureau » ; « Ma position » : « Ma position »', async () => {
    const { f, picks } = setup({ settings: preset() });
    f.input.focus();
    await settle();
    [...f.list.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((b) => textOf(b).startsWith('Bureau'))!.click();
    expect(f.input.value).toBe('Bureau');
    expect(picks.at(-1)).toMatchObject({ kind: 'place', label: 'Bureau' });
    expect(f.list.hidden).toBe(true);
    expect(f.input.getAttribute('aria-expanded')).toBe('false');
    f.input.blur();
    f.input.focus();
    await settle();
    [...f.list.querySelectorAll<HTMLButtonElement>('[role="option"]')][0].click();
    expect(f.input.value).toBe('Ma position');
    expect(picks.at(-1)).toMatchObject({ kind: 'here' });
  });

  it('une gare choisie : son nom ; taper ensuite annule le choix (onEdit)', async () => {
    let edits = 0;
    const { f, picks } = setup({ settings: defaults() }, { onEdit: () => edits++ });
    await search(f, 'gand');
    f.list.querySelector<HTMLButtonElement>('[role="option"]')!.click();
    expect(f.input.value).toBe('Gand-Saint-Pierre');
    expect(picks.at(-1)).toMatchObject({ kind: 'stop', item: { id: 'sncb:8892007' } });
    expect(f.picked()).toBe(true);
    type(f.input, 'Gand-Saint-Pierre x');
    expect(edits).toBe(1);
    expect(f.picked()).toBe(false);
  });

  it('clavier : ↓ va aux propositions, Entrée choisit la première, Échap ferme', async () => {
    const { f, picks } = setup({ settings: defaults() });
    await search(f, 'namur');
    f.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(f.list.querySelector('button'));
    type(f.input, 'namur');
    await settle();
    f.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(picks.at(-1)).toMatchObject({ kind: 'stop', label: 'Namur' });
    type(f.input, 'gand');
    await settle();
    f.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(f.list.hidden).toBe(true);
  });

  it('cibles de 44 px au moins (feuille de style)', async () => {
    const { readFileSync } = await import('node:fs');
    const { URL: NodeURL } = await import('node:url');
    const css = readFileSync(new NodeURL('../../src/phone/styles.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.suggest button \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.shortcut \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.btn-glasses \{[^}]*min-height: 44px/);
  });
});
