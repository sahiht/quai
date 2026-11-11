/**
 * Interface du téléphone (page web de l'appli dans l'onglet Even Hub) : routeur par ancre (#/…)
 * et contexte partagé. Écrans : accueil, bienvenue et « Tes lieux » (Config1, S1), lieux (Config2),
 * favoris (Config3), affichage (Config4), alertes (Config5), données (Config6), recherche (Visite3).
 */
import type { Core, GlassesApi, Meta } from '../core/api';
import type { Freshness } from '../glasses/controller';
import type { Clock } from '../platform/clock';
import type { LocationPort } from '../platform/types';
import type { SettingsStore } from '../settings';
import { compareVersions } from '../version';
import { h, ICON, svgNode } from './dom';
import { alertsScreen } from './screens/alerts';
import { dataScreen } from './screens/data';
import { displayScreen } from './screens/display';
import { favoriteEditScreen, favoritesScreen } from './screens/favorites';
import { homeScreen } from './screens/home';
import { onboardingScreen, yourPlacesScreen } from './screens/onboarding';
import { placeEditScreen, placesScreen } from './screens/places';
import { searchScreen } from './screens/search';

export interface PhoneCtx {
  settings: SettingsStore;
  core(): Promise<Core>;
  coreNow(): Core | null;
  location: LocationPort;
  clock: Clock;
  /** Lunettes (contrôleur, GlassesApi) : bouton « Lunettes » des cartes et des favoris. */
  glasses(): GlassesApi | null;
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
  /**
   * Bannière de l'accueil après la mise à jour (T1), une fois : visible si les réglages lus au lancement venaient
   * d'une version antérieure (seenVersion non vide et inférieure à la version courante), jusqu'à « OK ».
   * Le téléphone n'écrit pas seenVersion pour elle : les lunettes s'en servent pour leur message « Quai 1.1 ».
   */
  news?: { visible(): boolean; dismiss(): void };
}

export type Screen = (ctx: PhoneCtx, sub: string[]) => HTMLElement | Promise<HTMLElement>;

const SCREENS: Record<string, { screen: Screen; grey?: boolean; title: string }> = {
  '': { screen: homeScreen, grey: true, title: 'Quai' },
  bienvenue: { screen: (c, s) => (s[0] === 'lieux' ? yourPlacesScreen(c) : onboardingScreen(c)), title: 'Bienvenue' },
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

/** Version qui a apporté les nouveautés de la bannière (adresses, trajet le plus simple) : la 1.1. */
export const NEWS_SINCE = '1.1.0';

/**
 * Bannière « Nouveau » : seulement au passage de la 1.0 à la 1.1.x (réglages vus avant 1.1.0 au lancement), jusqu'à
 * « OK ». Une mise à jour 1.1.0 → 1.1.1 ne la remontre pas (comme le message « Quai 1.1 » des lunettes).
 */
export function newsState(seenAtStart: string, since = NEWS_SINCE): { visible(): boolean; dismiss(): void } {
  let shown = !!seenAtStart && compareVersions(seenAtStart, since) < 0;
  return {
    visible: () => shown,
    dismiss: () => {
      shown = false;
    },
  };
}

export function mountPhone(deps: PhoneDeps): { refresh(): void } {
  let seq = 0;
  // Lu avant que les lunettes n'écrivent la version courante (message « Quai 1.1 »).
  const news = deps.news ?? newsState(deps.settings.get().seenVersion);
  const render = async (): Promise<void> => {
    const my = ++seq;
    let { name, sub, params } = parseHash(location.hash);
    // Premier lancement : l'écran de bienvenue (Config1) tant que la configuration n'est pas faite.
    if (!deps.settings.get().onboarded && name === '' && !params.has('accueil')) name = 'bienvenue';
    const def = SCREENS[name] ?? SCREENS[''];
    const ctx: PhoneCtx = {
      ...deps,
      params,
      news,
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
    // Un champ marqué data-autofocus reçoit le curseur (« Où vas-tu ? » : « Arrivée ») ; sinon le titre.
    const field = deps.root.querySelector<HTMLElement>('[data-autofocus]');
    const focus = deps.root.querySelector<HTMLElement>('h1');
    if (field && !params.has('vers')) field.focus({ preventScroll: true });
    else if (focus && name !== '') {
      focus.tabIndex = -1;
      focus.focus({ preventScroll: true });
    }
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
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
      ? h('button', { type: 'button', class: 'back', onclick: () => ctx.go(back.hash) }, svgNode(ICON.back), h('span', null, back.label))
      : h('span', { class: 'eyebrow' }, 'Quai'),
    h('h1', null, title),
    lead ? h('p', { class: 'lead' }, lead) : null,
  );
}
