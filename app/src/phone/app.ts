/**
 * Interface du téléphone (page web de l'appli dans l'onglet Even Hub) : routeur par ancre (#/…)
 * et contexte partagé. Écrans : accueil, bienvenue (Config1), lieux (Config2), favoris (Config3),
 * affichage (Config4), alertes (Config5), données (Config6), recherche (Visite3).
 */
import type { Core, Meta } from '../core/api';
import type { Freshness, GlassesController } from '../glasses/controller';
import type { Clock } from '../platform/clock';
import type { LocationPort } from '../platform/types';
import type { SettingsStore } from '../settings';
import { h, ICON } from './dom';
import { alertsScreen } from './screens/alerts';
import { dataScreen } from './screens/data';
import { displayScreen } from './screens/display';
import { favoriteEditScreen, favoritesScreen } from './screens/favorites';
import { homeScreen } from './screens/home';
import { onboardingScreen } from './screens/onboarding';
import { placeEditScreen, placesScreen } from './screens/places';
import { searchScreen } from './screens/search';

export interface PhoneCtx {
  settings: SettingsStore;
  core(): Promise<Core>;
  coreNow(): Core | null;
  location: LocationPort;
  clock: Clock;
  glasses(): GlassesController | null;
  meta(): Meta | null;
  freshness(): Freshness | null;
  coreError(): string | null;
  configured: boolean;
  /** Quai Web : la page n'est pas dans l'appli Even (textes adaptés, lunettes dans l'onglet Lunettes). */
  web?: boolean;
  /** Quai Web : montre l'onglet Lunettes (après « Afficher dans les lunettes »). */
  showGlasses?(): void;
  /** Quai Web : choix de la position (navigateur ou arrêt), pour l'écran « Position et langue ». */
  positionPicker?(): HTMLElement;
  go(hash: string): void;
  /** Paramètres de l'ancre courante (#/recherche?q=Gand). */
  params: URLSearchParams;
}

export type Screen = (ctx: PhoneCtx, sub: string[]) => HTMLElement | Promise<HTMLElement>;

const SCREENS: Record<string, { screen: Screen; grey?: boolean; title: string }> = {
  '': { screen: homeScreen, grey: true, title: 'Quai' },
  bienvenue: { screen: onboardingScreen, title: 'Bienvenue' },
  lieux: { screen: (c, s) => (s[0] ? placeEditScreen(c, s[0]) : placesScreen(c)), title: 'Mes lieux' },
  favoris: { screen: (c, s) => (s[0] ? favoriteEditScreen(c, s[0]) : favoritesScreen(c)), title: 'Mes favoris' },
  affichage: { screen: displayScreen, title: 'Affichage' },
  alertes: { screen: alertsScreen, title: 'Alertes' },
  donnees: { screen: dataScreen, title: 'Données' },
  recherche: { screen: searchScreen, grey: true, title: 'Rechercher un trajet' },
};

export interface PhoneDeps extends Omit<PhoneCtx, 'go' | 'params'> {
  root: HTMLElement;
  /** Élément qui reçoit la classe « grey » des écrans à fond gris (défaut : body). */
  themeTarget?: HTMLElement;
}

export function parseHash(hash: string): { name: string; sub: string[]; params: URLSearchParams } {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] ?? '', sub: parts.slice(1), params: new URLSearchParams(query) };
}

export function mountPhone(deps: PhoneDeps): { refresh(): void } {
  let seq = 0;
  const render = async (): Promise<void> => {
    const my = ++seq;
    let { name, sub, params } = parseHash(location.hash);
    // Premier lancement : l'écran de bienvenue (Config1) tant que la configuration n'est pas faite.
    if (!deps.settings.get().onboarded && name === '' && !params.has('accueil')) name = 'bienvenue';
    const def = SCREENS[name] ?? SCREENS[''];
    const ctx: PhoneCtx = {
      ...deps,
      params,
      go: (hash) => {
        if (location.hash === hash) void render();
        else location.hash = hash;
      },
    };
    (deps.themeTarget ?? document.body).classList.toggle('grey', !!def.grey);
    document.title = def.title === 'Quai' ? 'Quai' : `${def.title} · Quai`;
    let el: HTMLElement;
    try {
      el = await def.screen(ctx, sub);
    } catch (e) {
      el = h('div', null, h('p', { class: 'warn', role: 'alert' }, `Erreur : ${e instanceof Error ? e.message : String(e)}`));
    }
    if (my !== seq) return;
    deps.root.replaceChildren(el);
    const focus = deps.root.querySelector<HTMLElement>('h1');
    if (focus && name !== '') {
      focus.tabIndex = -1;
      focus.focus({ preventScroll: true });
    }
    window.scrollTo(0, 0);
  };
  window.addEventListener('hashchange', () => void render());
  void render();
  return { refresh: () => void render() };
}

/** En-tête commun : sur-titre « Quai », titre, sous-titre éventuel, bouton retour. */
export function header(ctx: PhoneCtx, title: string, lead?: string, back?: { label: string; hash: string }): HTMLElement {
  return h(
    'header',
    { class: 'head' },
    back
      ? h('button', { type: 'button', class: 'back', onclick: () => ctx.go(back.hash), html: `${ICON.back}<span>${back.label}</span>` })
      : h('span', { class: 'eyebrow' }, 'Quai'),
    h('h1', null, title),
    lead ? h('p', { class: 'lead' }, lead) : null,
  );
}
