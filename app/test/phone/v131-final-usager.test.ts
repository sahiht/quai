// @vitest-environment happy-dom
/**
 * Quai 1.3.1, contrôle usager final : deux textes du téléphone gardaient une espace ordinaire là où la règle de l'appli
 * veut une insécable (devant « : », entre un nombre et son unité) : la carte « Portail des opérateurs » de Données et
 * l'aide de « Pluie pendant la marche » dans Affichage. Lus dans la page montée, comme la personne les voit.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { dataScreen } from '../../src/phone/screens/data';
import { displayScreen } from '../../src/phone/screens/display';
import { defaults, harness, mount, settle } from './helpers';

const NB = ' ';

afterEach(() => document.body.replaceChildren());

/** Textes des éléments feuilles d'un écran (ce qui est écrit, sans les étiquettes des lecteurs d'écran). */
const texts = (el: HTMLElement): string[] =>
  [...el.querySelectorAll<HTMLElement>('*')]
    .filter((n) => n.children.length === 0)
    .map((n) => n.textContent ?? '')
    .filter((t) => t.trim());

describe('contrôle usager final : insécables de Données et d’Affichage', () => {
  it('Données, « Portail des opérateurs » : insécable devant le deux-points', async () => {
    const el = mount(dataScreen(harness({ settings: defaults() }).ctx));
    await settle(12);
    const line = texts(el).find((t) => t.startsWith('Belgian Mobility Company'));
    expect(line).toBe(`Belgian Mobility Company${NB}: SNCB, STIB, De Lijn et TEC. Clé enregistrée à l’installation, dans ton relais.`);
  });

  it('Affichage, « Pluie pendant la marche » : insécable entre « 5 » et « min »', () => {
    const el = mount(displayScreen(harness({ settings: defaults() }).ctx));
    const line = texts(el).find((t) => t.startsWith('sur les marches'));
    expect(line).toBe(`sur les marches de 5${NB}min ou plus, d’après Open-Meteo`);
  });

  it('Données et Affichage, téléphone et Quai Web : aucune espace ordinaire devant « : ; ! ? » ni entre un nombre et « min », « m », « km », « h » ; ni tiret long ni moyen ; aucune apostrophe droite', async () => {
    for (const web of [false, true]) {
      const hz = harness({ settings: defaults(), web });
      const data = mount(dataScreen(hz.ctx));
      await settle(12);
      const all = [...texts(data), ...texts(mount(displayScreen(hz.ctx)))].filter((t) => !t.includes('\n'));
      expect(all.length).toBeGreaterThan(20);
      for (const t of all) {
        expect(t, t).not.toMatch(/ [:;!?](?=\s|$)/);
        expect(t, t).not.toMatch(/\d (min|m|km|h)\b/);
        expect(t, t).not.toMatch(/[–—']/);
      }
    }
  });
});
