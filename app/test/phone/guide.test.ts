// @vitest-environment happy-dom
/**
 * Quai 1.2.10 « Y aller », téléphone (PRD-1.2.10 § 4.2 et § 4.3) : bouton « Y aller » sur chaque favori (carte
 * « Favoris » de l'accueil, ses autres favoris, « Mes favoris »), seulement si les lunettes savent guider
 * (GlassesApi.goFavorite) ; son message à côté de lui ; carte « En cours » en tête de l'accueil pendant un trajet suivi,
 * mise à jour en direct (onGuide), « Arrêter le guidage » (« Arrêter le suivi » sans guidage). Lieux publics seulement.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideStatus } from '../../src/core/guide-types';
import { favoritesScreen } from '../../src/phone/screens/favorites';
import { homeScreen, resetAnswers } from '../../src/phone/screens/home';
import { at, button, defaults, harness, mount, plain, preset11, SCENARIO, settle, textOf, until, withGuide, type Harness } from './helpers';

beforeEach(() => resetAnswers());
afterEach(() => document.body.replaceChildren());

const favRows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.fav-card .fav-row')];
const STATUS: GuideStatus = { kind: 'trip', title: 'Bureau', arr: at(8, 54), now: 'bus 6 vers Gare des Guillemins', guided: true };
const home = (hz: Harness): HTMLElement => mount(homeScreen(hz.ctx));
const card = (el: HTMLElement) => el.querySelector<HTMLElement>('.now-card');
/** Lignes de la carte « En cours » : titre, trajet, maintenant, bouton. */
const cardText = (el: HTMLElement) => {
  const c = card(el)!;
  return [textOf(c.querySelector('h2')), textOf(c.querySelector('.now-trip')), textOf(c.querySelector('.now-now')), textOf(c.querySelector('button'))];
};

describe('« Y aller » sur la carte « Favoris » de l’accueil (PRD-1.2.10 § 4.2)', () => {
  it('lunettes sans guidage (appli plus ancienne) : pas de « Y aller », le bouton « Lunettes » reste écrit en entier', () => {
    const el = home(harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } }));
    expect(favRows(el)).toHaveLength(3);
    expect(el.querySelector('.btn-go')).toBeNull();
    for (const r of favRows(el)) expect(textOf(r.querySelector('.btn-glasses'))).toBe('Lunettes');
    // sans lunettes du tout : rien non plus
    const none = home(harness({ settings: preset11(), glasses: false }));
    expect(none.querySelector('.btn-go')).toBeNull();
  });

  it('chaque favori : « Lunettes » (son icône, nommée) puis « Y aller » (un vrai bouton, nommé avec le favori) ; un seul message', () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    withGuide(hz.glasses);
    const el = home(hz);
    const rows = favRows(el);
    expect(rows.map((r) => textOf(r.querySelector('.t1')))).toEqual(['Vers le bureau', 'Vers Gand-Saint-Pierre', 'Vers la maison']);
    for (const r of rows) {
      const name = textOf(r.querySelector('.t1'));
      const buttons = [...r.querySelectorAll<HTMLButtonElement>('button')];
      expect(buttons.map((b) => [b.className, b.type, textOf(b), plain(b.getAttribute('aria-label'))])).toEqual([
        ['btn btn-glasses btn-icon', 'button', '', `Afficher ${name} dans les lunettes`],
        ['btn btn-go', 'button', 'Y aller', `Y aller : ${name}`],
      ]);
      // l'icône seule : « Lunettes » au survol, dessin décoratif
      expect(buttons[0].getAttribute('title')).toBe('Lunettes');
      expect(buttons[0].querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
      // typographie : espace insécable devant « : » du nom lu
      expect(buttons[1].getAttribute('aria-label')).toContain('Y aller :');
      expect(r.querySelectorAll('.msg')).toHaveLength(1);
    }
  });

  it('toucher « Y aller » : goFavorite(id), bouton grisé le temps de la réponse, puis le message des lunettes à côté ; Quai Web : l’onglet Lunettes s’ouvre', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true }, web: true });
    const guide = withGuide(hz.glasses);
    const shown = vi.fn();
    hz.ctx.showGlasses = shown;
    const el = home(hz);
    const row = favRows(el)[1];
    const go = row.querySelector<HTMLButtonElement>('.btn-go')!;
    go.click();
    expect(go.disabled).toBe(true);
    await until(() => textOf(row.querySelector('.msg')) !== '');
    expect(guide.went).toEqual(['fav-gand']);
    expect(row.querySelector('.msg')!.textContent).toBe('Guidage lancé sur les lunettes : bus 6 à 07:12.');
    expect(row.querySelector('.msg')!.classList.contains('err')).toBe(false);
    expect([row.querySelector('.msg')!.getAttribute('role'), row.querySelector('.msg')!.getAttribute('aria-live')]).toEqual(['status', 'polite']);
    expect(go.disabled).toBe(false);
    expect(shown).toHaveBeenCalledTimes(1);
    // un lieu aussi (« Vers le bureau » : le favori lieu fav-bureau)
    favRows(el)[0].querySelector<HTMLButtonElement>('.btn-go')!.click();
    await until(() => guide.went.length === 2);
    expect(guide.went).toEqual(['fav-gand', 'fav-bureau']);
    // un seul message à l'écran : celui du dernier bouton touché
    await until(() => textOf(favRows(el)[0].querySelector('.msg')) !== '');
    expect(textOf(row.querySelector('.msg'))).toBe('');
  });

  it('l’erreur des lunettes est dite, en rouge ; sans message rendu : « Guidage lancé sur les lunettes. », ou « Trajet suivi » quand le guidage est éteint', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const guide = withGuide(hz.glasses);
    guide.reply = new Error('Aucun trajet trouvé à cette heure.');
    const el = home(hz);
    const msg = () => favRows(el)[0].querySelector<HTMLElement>('.msg')!;
    favRows(el)[0].querySelector<HTMLButtonElement>('.btn-go')!.click();
    await until(() => textOf(msg()) !== '');
    expect([textOf(msg()), msg().classList.contains('err')]).toEqual(['Aucun trajet trouvé à cette heure.', true]);
    guide.reply = '';
    favRows(el)[0].querySelector<HTMLButtonElement>('.btn-go')!.click();
    await until(() => textOf(msg()) === 'Guidage lancé sur les lunettes.');
    expect(msg().classList.contains('err')).toBe(false);
    await hz.settings.update((s) => ({ ...s, display: { ...s.display, guide: false } }));
    favRows(el)[0].querySelector<HTMLButtonElement>('.btn-go')!.click();
    await until(() => textOf(msg()) === 'Trajet suivi dans les lunettes.');
  });

  it('« Lunettes » (l’icône) affiche toujours le trajet, et son message va au même endroit', async () => {
    const hz = harness({ settings: preset11(), now: SCENARIO.s1.now, here: SCENARIO.s1, flags: { noRt: true } });
    const guide = withGuide(hz.glasses);
    const el = home(hz);
    await until(() => favRows(el).every((r) => textOf(r.querySelector('.answer')) !== '…'));
    const row = favRows(el)[0];
    // le premier bouton de la rangée est toujours « Lunettes » (bout en bout : row.querySelector('button'))
    row.querySelector<HTMLButtonElement>('button')!.click();
    await until(() => textOf(row.querySelector('.msg')) !== '');
    expect(hz.glasses.trips).toHaveLength(1);
    expect(guide.went).toEqual([]);
    expect(textOf(row.querySelector('.msg'))).toMatch(/^Affiché dans les lunettes : IC 07:42\.$/);
  });

  it('« Voir les 2 autres favoris » : les leurs ont aussi « Y aller » ; le curseur va sur « Lunettes » du premier ajouté', async () => {
    const base = preset11();
    const extra = (id: string, label: string) => ({ ...base.favorites.find((f) => f.kind === 'place' && f.id === 'fav-bureau')!, id, label }) as (typeof base.favorites)[number];
    const hz = harness({ settings: { ...base, favorites: [...base.favorites, extra('fav-ecole', 'École'), extra('fav-sport', 'Sport')] } });
    const guide = withGuide(hz.glasses);
    const el = home(hz);
    button(el, 'Voir les 2 autres favoris').click();
    const rows = favRows(el);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.querySelector('.btn-go'))).toBe(true);
    expect(document.activeElement).toBe(rows[3].querySelector('button.btn-glasses'));
    rows[4].querySelector<HTMLButtonElement>('.btn-go')!.click();
    await until(() => guide.went.length === 1);
    expect(guide.went).toEqual(['fav-sport']);
  });
});

describe('« Y aller » dans « Mes favoris » (la liste complète)', () => {
  const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLLIElement>('.screen ul.list > li')];

  it('sans guidage : la liste de la 1.2.9 (chevron, pas de « Y aller »)', () => {
    const el = mount(favoritesScreen(harness({ settings: preset11() }).ctx));
    expect(el.querySelector('.btn-go')).toBeNull();
    expect(rows(el).every((li) => li.querySelector('.chev'))).toBe(true);
  });

  it('chaque favori, lieu ou trajet : la rangée (toucher : modifier) puis « Y aller » au bout, son message dessous ; plus de chevron à côté', async () => {
    const hz = harness({ settings: preset11() });
    const guide = withGuide(hz.glasses);
    const el = mount(favoritesScreen(hz.ctx));
    const all = rows(el);
    expect(all).toHaveLength(3);
    for (const li of all) {
      // bout en bout : `.screen ul.list > li > button.row` reste la rangée
      expect([...li.children].map((c) => c.tagName + '.' + c.className.split(' ')[0])).toEqual(['BUTTON.row', 'BUTTON.btn', 'P.msg']);
      expect(li.querySelector('.chev')).toBeNull();
      expect(li.classList.contains('fav-go')).toBe(true);
    }
    expect(all.map((li) => plain(li.querySelector('.btn-go')!.getAttribute('aria-label')))).toEqual(['Y aller : Bureau', 'Y aller : Bruxelles-Central → Gand-Saint-Pierre', 'Y aller : Maison']);
    // le trajet fixe
    all[1].querySelector<HTMLButtonElement>('.btn-go')!.click();
    await until(() => textOf(all[1].querySelector('.msg')) !== '');
    expect(guide.went).toEqual(['fav-gand']);
    expect(textOf(all[1].querySelector('.msg'))).toBe('Guidage lancé sur les lunettes : bus 6 à 07:12.');
    // la rangée garde son toucher : modifier le favori
    all[0].querySelector<HTMLButtonElement>('button.row')!.click();
    expect(hz.went).toEqual(['#/favoris/fav-bureau']);
    expect(all[0].querySelector('button.row')!.getAttribute('aria-label')).toBe('Modifier Bureau');
  });

  it('« Changer l’ordre » : pas de « Y aller » pendant le rangement ; « Terminé » le rend', () => {
    const hz = harness({ settings: preset11() });
    withGuide(hz.glasses);
    const el = mount(favoritesScreen(hz.ctx));
    button(el, 'Changer l’ordre').click();
    expect(el.querySelector('.btn-go')).toBeNull();
    button(el, 'Terminé').click();
    expect(el.querySelectorAll('.btn-go')).toHaveLength(3);
  });
});

describe('carte « En cours » de l’accueil (PRD-1.2.10 § 4.3)', () => {
  it('aucun trajet suivi, ou lunettes sans guidage : pas de carte, aucune place prise', () => {
    const hz = harness({ settings: defaults() });
    withGuide(hz.glasses, null);
    const el = home(hz);
    expect(card(el)).toBeNull();
    expect(el.querySelector('.now-slot')!.childElementCount).toBe(0);
    expect(textOf(el)).not.toMatch(/En cours|guidage/);
    const old = home(harness({ settings: defaults() }));
    expect(card(old)).toBeNull();
  });

  it('pendant un trajet suivi : en tête de l’accueil, « En cours », « Bureau, arrivée 08:54 », « Maintenant : bus 6 vers Gare des Guillemins », « Arrêter le guidage »', () => {
    const hz = harness({ settings: defaults() });
    withGuide(hz.glasses, STATUS);
    const el = home(hz);
    // juste sous l'en-tête, avant « Où vas-tu ? »
    expect([...el.children].slice(0, 3).map((c) => c.className.split(' ')[0])).toEqual(['head', 'now-slot', 'where']);
    expect(cardText(el)).toEqual(['En cours', 'Bureau, arrivée 08:54', 'Maintenant : bus 6 vers Gare des Guillemins', 'Arrêter le guidage']);
    const c = card(el)!;
    expect(c.tagName).toBe('SECTION');
    expect(c.getAttribute('aria-labelledby')).toBe(c.querySelector('h2')!.id);
    // typographie : espace insécable devant « : » ; la ligne « Maintenant » est annoncée quand elle change
    expect(c.querySelector('.now-now')!.textContent).toBe('Maintenant : bus 6 vers Gare des Guillemins');
    expect(c.querySelector('.now-now')!.getAttribute('aria-live')).toBe('polite');
    expect(c.querySelector('button')!.type).toBe('button');
  });

  it('en direct (onGuide) : elle change sans être redessinée, disparaît quand plus rien n’est suivi, revient avec le trajet suivant', () => {
    const hz = harness({ settings: defaults() });
    const guide = withGuide(hz.glasses, STATUS);
    const el = home(hz);
    const c = card(el)!;
    const stop = c.querySelector('button')!;
    guide.emit({ ...STATUS, now: 'à pied vers l’arrêt du bus 71', arr: at(9, 2) });
    expect(card(el)).toBe(c);
    expect(c.querySelector('button')).toBe(stop);
    expect(cardText(el)).toEqual(['En cours', 'Bureau, arrivée 09:02', 'Maintenant : à pied vers l’arrêt du bus 71', 'Arrêter le guidage']);
    guide.emit(null);
    expect(card(el)).toBeNull();
    expect(el.querySelector('.now-slot')!.childElementCount).toBe(0);
    guide.emit({ kind: 'ride', title: 'Vers Bruxelles-Central', arr: at(13, 40), now: 'IC vers Bruxelles-Midi', guided: true });
    expect(cardText(el)).toEqual(['En cours', 'Vers Bruxelles-Central, arrivée 13:40', 'Maintenant : IC vers Bruxelles-Midi', 'Arrêter le guidage']);
  });

  it('guidage éteint (guided faux) : « Arrêter le suivi », aucun « guidage » trompeur ; rien à dire maintenant : pas de ligne « Maintenant »', () => {
    const hz = harness({ settings: defaults({ display: { ...defaults().display, guide: false } }) });
    const guide = withGuide(hz.glasses, { ...STATUS, guided: false });
    const el = home(hz);
    expect(cardText(el)).toEqual(['En cours', 'Bureau, arrivée 08:54', 'Maintenant : bus 6 vers Gare des Guillemins', 'Arrêter le suivi']);
    expect(textOf(card(el))).not.toMatch(/guidage/i);
    guide.emit({ ...STATUS, guided: false, now: '' });
    expect(card(el)!.querySelector<HTMLElement>('.now-now')!.hidden).toBe(true);
    // rallumé entre-temps : le bouton le redit
    guide.emit(STATUS);
    expect(textOf(card(el)!.querySelector('button'))).toBe('Arrêter le guidage');
  });

  it('« Arrêter le guidage » : stopGuide, la carte laisse place à « Guidage arrêté. », qui reçoit le curseur ; « Suivi arrêté. » sans guidage', async () => {
    for (const guided of [true, false]) {
      const hz = harness({ settings: defaults() });
      const guide = withGuide(hz.glasses, { ...STATUS, guided });
      const el = home(hz);
      const stop = card(el)!.querySelector<HTMLButtonElement>('button')!;
      stop.focus();
      stop.click();
      await until(() => card(el) === null && textOf(el.querySelector('.now-done')) !== '');
      expect(guide.stops).toBe(1);
      const done = el.querySelector<HTMLElement>('.now-done')!;
      expect(textOf(done)).toBe(guided ? 'Guidage arrêté.' : 'Suivi arrêté.');
      expect(done.getAttribute('role')).toBe('status');
      expect(document.activeElement).toBe(done);
      // un nouveau trajet suivi : la carte revient à sa place
      guide.emit(STATUS);
      expect(card(el)).not.toBeNull();
      expect(el.querySelector('.now-done')).toBeNull();
    }
  });

  it('arrêt refusé par les lunettes : l’erreur est dite dans la carte, qui reste ; le bouton se réactive', async () => {
    const hz = harness({ settings: defaults() });
    const guide = withGuide(hz.glasses, STATUS);
    guide.stopError = new Error('Lunettes indisponibles pour l’instant.');
    const el = home(hz);
    const stop = card(el)!.querySelector<HTMLButtonElement>('button')!;
    stop.click();
    await until(() => textOf(card(el)!.querySelector('.msg')) !== '');
    expect([textOf(card(el)!.querySelector('.msg')), card(el)!.querySelector('.msg')!.classList.contains('err')]).toEqual(['Lunettes indisponibles pour l’instant.', true]);
    expect(stop.disabled).toBe(false);
    // le message part avec un nouvel essai réussi
    guide.stopError = undefined;
    stop.click();
    await until(() => card(el) === null);
  });

  it('le trajet se termine tout seul pendant que le curseur est sur le bouton : le titre de l’accueil reçoit le curseur', () => {
    const hz = harness({ settings: defaults() });
    const guide = withGuide(hz.glasses, STATUS);
    const el = home(hz);
    card(el)!.querySelector<HTMLButtonElement>('button')!.focus();
    guide.emit(null);
    expect(document.activeElement).toBe(el.querySelector('h1'));
  });

  it('lunettes qui ne savent pas arrêter (stopGuide absent) : la carte sans bouton ; sans onGuide : l’état du rendu', () => {
    const hz = harness({ settings: defaults() });
    withGuide(hz.glasses, STATUS, ['guideStatus']);
    const el = home(hz);
    expect(card(el)!.querySelector('button')).toBeNull();
    expect(cardText(el).slice(0, 3)).toEqual(['En cours', 'Bureau, arrivée 08:54', 'Maintenant : bus 6 vers Gare des Guillemins']);
  });

  it('lunettes en erreur (guideStatus ou onGuide lèvent) : l’accueil s’affiche quand même, sans carte', () => {
    const hz = harness({ settings: defaults() });
    Object.assign(hz.glasses, {
      guideStatus: () => {
        throw new Error('pas prêt');
      },
      onGuide: () => {
        throw new Error('pas prêt');
      },
    });
    const el = home(hz);
    expect(textOf(el.querySelector('h1'))).toBe('Bonjour');
    expect(card(el)).toBeNull();
    expect(el.querySelector('.mirror-sec')).not.toBeNull();
  });

  it('l’accueil quitté (ou jamais posé) : il ne suit plus le guidage', async () => {
    const hz = harness({ settings: defaults() });
    const guide = withGuide(hz.glasses, STATUS);
    home(hz);
    expect(guide.listeners()).toBe(1);
    await settle(1);
    document.body.replaceChildren();
    guide.emit({ ...STATUS, now: 'IC vers Courtrai' });
    expect(guide.listeners()).toBe(0);
    // jamais posé (le routeur est passé à un autre écran) : désinscrit au tour suivant
    homeScreen(hz.ctx);
    expect(guide.listeners()).toBe(1);
    await settle(2);
    expect(guide.listeners()).toBe(0);
  });
});

describe('cibles tactiles et contraste (styles.css)', () => {
  const css = readFileSync(fileURLToPath(new NodeURL('../../src/phone/styles.css', import.meta.url)), 'utf8');
  const rule = (sel: string): string => {
    const m = new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(css);
    if (!m) throw new Error(`règle absente : ${sel}`);
    return m[2];
  };
  it('« Y aller », l’icône « Lunettes », « Arrêter le guidage » : 44 px au moins ; « Y aller » vert foncé sur vert pâle (4,5:1 au moins)', () => {
    expect(rule('.btn')).toMatch(/min-height: 44px/);
    expect(rule('.btn-go')).toMatch(/min-height: 44px/);
    expect(rule('.btn-icon')).toMatch(/width: 44px; min-width: 44px/);
    expect(rule('.btn-secondary')).toMatch(/min-height: 48px/);
    expect(rule('.btn-go')).toMatch(/background: var\(--accent-soft\); color: var\(--accent-ink\)/);
    const color = (name: string) => new RegExp(`--${name}: #([0-9a-f]{6})`).exec(rule(':root'))![1];
    // contraste (WCAG) du texte du bouton sur son fond
    const lum = (hex: string) => {
      const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    expect(ratio(color('accent-ink'), color('accent-soft'))).toBeGreaterThan(4.5);
    // « En cours » (titre), en vert foncé sur blanc
    expect(rule('.now-title')).toMatch(/color: var\(--accent-ink\)/);
    expect(ratio(color('accent-ink'), color('card'))).toBeGreaterThan(4.5);
  });
});
