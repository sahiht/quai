/**
 * Interface du téléphone (page web de l'appli dans l'onglet Even Hub) : routeur par ancre (#/…)
 * et contexte partagé. Écrans : accueil, bienvenue et « Tes favoris » (Config1, S1), « Mes favoris » (endroits et
 * trajets fixes, PRD-1.2 § 2.2), affichage (Config4), alertes (Config5), données (Config6), recherche (Visite3).
 * « Mes lieux » (#/lieux) n'existe plus : son ancre mène à « Mes favoris ».
 * 1.2.2 (PRD-1.2.2 § 4) : #/gares et #/lignes (Quai Web : ouverts par les lunettes) montrent la section de l'accueil,
 * ou l'ajout si elle est vide ; #/gares/ajouter, #/lignes/ajouter (?arret=… : arrêt présélectionné) ; #/trajets
 * (revue d'usage n° 9). 1.2.3 (PRD-1.2.3 § 3) : #/lignes/ajouter ouvre le choix « Une ligne » | « Un arrêt » ;
 * #/lignes/ajouter/ligne et #/lignes/ajouter/arret, l'un ou l'autre d'emblée.
 */
import type { Core, GlassesApi, Meta } from '../core/api';
import type { Freshness } from '../glasses/controller';
import type { Clock } from '../platform/clock';
import type { LocationPort } from '../platform/types';
import type { SettingsStore } from '../settings';
import { APP_VERSION, compareVersions } from '../version';
import { h, ICON, svgNode } from './dom';
import { alertsScreen } from './screens/alerts';
import { dataScreen } from './screens/data';
import { displayScreen } from './screens/display';
import { favoriteEditScreen, fixedTripScreen, newFavoriteScreen } from './screens/favorite-edit';
import { favoritesScreen } from './screens/favorites';
import { homeScreen } from './screens/home';
import { onboardingScreen, yourFavoritesScreen } from './screens/onboarding';
import { addLineScreen, addStationScreen } from './screens/pick-add';
import { searchScreen } from './screens/search';
import { tripsScreen } from './screens/trips';
import { newsLines, T } from './text';

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
  /** Quai Web : choix de la position (navigateur, adresse ou arrêt), pour l'écran « Position et langue ». */
  positionPicker?(): HTMLElement;
  go(hash: string): void;
  /** Paramètres de l'ancre courante (#/recherche?q=Gand). */
  params: URLSearchParams;
  /**
   * Bannière de l'accueil après la mise à jour (T1), une fois : visible si les réglages lus au lancement venaient
   * d'une version antérieure à NEWS_SINCE (seenVersion non vide), jusqu'à « OK ». Le téléphone n'écrit pas
   * seenVersion pour elle : les lunettes s'en servent pour leur message « Quai 1.2.3 ».
   */
  news?: NewsState;
}

export type Screen = (ctx: PhoneCtx, sub: string[]) => HTMLElement | Promise<HTMLElement>;

interface Route {
  screen: Screen;
  /** Fond gris (accueil, recherche) ; une fonction quand l'ancre mène à des écrans différents (#/gares). */
  grey?: boolean | ((ctx: PhoneCtx, sub: string[]) => boolean);
  title: string;
}

/**
 * #/gares et #/lignes (PRD-1.2.2 § 1.3 et § 4, Quai Web) : la section de l'accueil, curseur sur son titre ; vide, ou
 * #/…/ajouter : l'ajout.
 */
function pickRoute(kind: 'stations' | 'lines'): Route {
  const adding = (c: PhoneCtx, s: string[]): boolean => s[0] === 'ajouter' || !c.settings.get()[kind].length;
  return {
    screen: (c, s) => (adding(c, s) ? (kind === 'stations' ? addStationScreen(c) : addLineScreen(c, s[1] === 'arret' ? 'stop' : 'line')) : homeScreen(c, [], { focus: kind })),
    grey: (c, s) => !adding(c, s),
    title: kind === 'stations' ? T.stations : T.lines,
  };
}

const SCREENS: Record<string, Route> = {
  '': { screen: homeScreen, grey: true, title: 'Quai' },
  bienvenue: { screen: (c, s) => (s[0] === 'favoris' || s[0] === 'lieux' ? yourFavoritesScreen(c) : onboardingScreen(c)), title: 'Bienvenue' },
  favoris: { screen: favoritesRoute, title: 'Mes favoris' },
  gares: pickRoute('stations'),
  lignes: pickRoute('lines'),
  trajets: { screen: tripsScreen, title: T.trips },
  affichage: { screen: displayScreen, title: 'Affichage' },
  alertes: { screen: alertsScreen, title: 'Alertes' },
  donnees: { screen: dataScreen, title: 'Données' },
  recherche: { screen: searchScreen, grey: true, title: 'Rechercher un trajet' },
};

/** « Mes favoris », « Nouveau favori » (#/favoris/trajet : choix « Un trajet de A à B »), ou la modification d'un favori. */
function favoritesRoute(c: PhoneCtx, s: string[]): HTMLElement {
  if (s[0] === 'nouveau') return newFavoriteScreen(c);
  if (s[0] === 'trajet') return fixedTripScreen(c);
  return s[0] ? favoriteEditScreen(c, s[0]) : favoritesScreen(c);
}

/** Ancre de la 1.1 vers « Mes lieux » (#/lieux, #/lieux/nouveau, #/lieux/{id}) : la même chose dans « Mes favoris ». */
export function legacyHash(hash: string): string | null {
  const m = /^#\/?lieux(?=$|[/?])(\/[^?]*)?(\?.*)?$/.exec(hash);
  if (!m) return null;
  return `#/favoris${m[1] ?? ''}`;
}

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

/** Version qui a apporté les nouveautés de la bannière (tableaux complets, arrêts d'un départ, PRD-1.2.3 § 4) : la 1.2.3. */
export const NEWS_SINCE = '1.2.3';

/** Bannière « Nouveau » de l'accueil : visible ou non, « OK », et ses lignes (newsLines). */
export interface NewsState {
  visible(): boolean;
  dismiss(): void;
  lines: string[];
}

/**
 * Bannière « Nouveau » : une fois, au passage d'une version antérieure à la 1.2.3 ou plus (réglages vus avant 1.2.3
 * au lancement), jusqu'à « OK », comme le message « Quai 1.2.3 » des lunettes ; jamais après une installation neuve.
 * `app` : la version de l'appli.
 */
export function newsState(seenAtStart: string, since = NEWS_SINCE, app = APP_VERSION): NewsState {
  let shown = !!seenAtStart && compareVersions(seenAtStart, since) < 0 && compareVersions(app, since) >= 0;
  return {
    visible: () => shown,
    dismiss: () => {
      shown = false;
    },
    lines: newsLines(seenAtStart),
  };
}

export function mountPhone(deps: PhoneDeps): { refresh(): void } {
  let seq = 0;
  // Lu avant que les lunettes n'écrivent la version courante (message « Quai 1.2.1 »).
  const news = deps.news ?? newsState(deps.settings.get().seenVersion);
  const render = async (): Promise<void> => {
    const my = ++seq;
    // « Mes lieux » de la 1.1 : l'ancre est remplacée par celle de « Mes favoris » (sans entrée d'historique).
    const legacy = legacyHash(location.hash);
    if (legacy) history.replaceState(null, '', legacy);
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
    const grey = typeof def.grey === 'function' ? def.grey(ctx, sub) : !!def.grey;
    (deps.themeTarget ?? document.body).classList.toggle('grey', grey);
    document.title = def.title === 'Quai' ? 'Quai' : `${def.title} · Quai`;
    let el: HTMLElement;
    try {
      el = await def.screen(ctx, sub);
    } catch (e) {
      el = h('div', null, h('p', { class: 'warn', role: 'alert' }, `Erreur : ${e instanceof Error ? e.message : String(e)}`));
    }
    if (my !== seq) return;
    deps.root.replaceChildren(el);
    // Une section marquée data-focus (#/gares, #/lignes) : son titre reçoit le curseur, la page la montre.
    const section = deps.root.querySelector<HTMLElement>('[data-focus]');
    if (section) {
      section.tabIndex = -1;
      section.focus({ preventScroll: true });
      section.scrollIntoView?.({ block: 'start' });
      return;
    }
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
