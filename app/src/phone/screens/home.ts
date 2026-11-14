/**
 * Accueil du téléphone (T1). 1.2.9 (PRD-1.2.9 § 2.1, piste C « Le miroir des lunettes ») : en-tête « Bonjour » et
 * bouton « Réglages » (#/reglages) ; alertes « Quai n’est pas configuré » et « Horaires périmés » ; « Où vas-tu ? »
 * (la recherche) ; bannière « Nouveau » sur une ligne, les nouveautés dépliées à la demande ; « Dans tes lunettes » :
 * les rubriques de l'accueil des lunettes, mêmes mots, même ordre, une ligne chacune qui ouvre son écran. « Favoris »
 * et, en retrait, jusqu'à 3 favoris dans l'ordre des lunettes, chacun avec sa réponse courte et son bouton « Lunettes »
 * (S8) ; « Autour de moi » ; « Gares de train », « Arrêts de bus, tram, métro », « Lignes de bus, tram, métro », leur
 * contenu à droite ou « à choisir » (le toucher ouvre alors l'ajout). Les autres réglages sont dans Réglages.
 */
import type { Core, FavoriteAnswer, Settings } from '../../core/api';
import { asTrip, favoriteTitle } from '../../core/favorites';
import type { LineFollow } from '../../core/linerun';
import { NEWS_SINCE, type PhoneCtx } from '../app';
import { lineBadge } from '../badges';
import { h, icon, ICON, svgNode, type Child } from '../dom';
import { glassesButton, showTrip } from '../glasses-link';
import { catchable, SECTION } from '../../glasses/format';
import { HOME_FAVORITES } from '../../glasses/views';
import { counted, lineName, newsTitle, shortAnswer, T, typo, withinText } from '../text';
import { messageHub, MIRROR_ICON, navRow, nextId } from '../ui';
import { shownFavorites, type ShownFavorite } from './favorites';
import { linePickName, stationTitle, type PickKind } from './picks';

/** Rafraîchissement des réponses des favoris (comme les lunettes). */
export const ANSWER_REFRESH_MS = 30_000;
/** Au-delà, une réponse gardée n'est plus envoyée telle quelle aux lunettes : elle est recalculée. */
export const ANSWER_MAX_AGE_MS = 2 * 60_000;

/**
 * Réponse d'un trajet favori encore bonne à envoyer aux lunettes : calculée il y a moins de 2 min et dont la
 * 1re proposition est encore attrapable (on peut partir à temps pour son premier véhicule).
 */
export function reusable(a: FavoriteAnswer | undefined, now: number): a is FavoriteAnswer {
  if (!a || now - a.updatedAt >= ANSWER_MAX_AGE_MS || now < a.updatedAt) return false;
  const j = a.plan?.journeys[0];
  return !j || catchable(j, now);
}

/** Dernières réponses connues, pour l'ordre (règle 5) et un affichage immédiat au retour sur l'accueil. */
const lastAnswers = new Map<string, FavoriteAnswer>();

/** Favoris dans l'ordre des lunettes (ordre intelligent du cœur, ou « Dans mon ordre ») : endroits et trajets. */
export function orderedFavorites(core: Core | null, settings: Settings, here: { lat: number; lon: number } | null): ShownFavorite[] {
  const all = shownFavorites(settings.favorites);
  if (!core) return all;
  try {
    const ranks = core.orderFavorites(here, settings, lastAnswers);
    const byId = new Map(all.map((f) => [f.id, f]));
    const out = ranks.map((r) => byId.get(r.favoriteId)).filter((f): f is ShownFavorite => !!f);
    for (const f of all) if (!out.includes(f)) out.push(f);
    return out;
  } catch {
    return all;
  }
}

/* ------------------------------ Rubriques (sans DOM) ------------------------------ */

/** Une rubrique de l'accueil des lunettes, son contenu et l'écran qu'elle ouvre. */
export interface Rubric {
  kind: PickKind;
  /** Mot clé et précision pâle, les mots des lunettes (SECTION : « Gares » et « de train »). */
  key: string;
  qual: string;
  /** Ses éléments, dans l'ordre des lunettes (« Namur », « Gare du Nord », « Tram 3 »). */
  names: string[];
  /** À droite : « 2 gares », « 1 arrêt », « 3 lignes », ou « à choisir » pour une rubrique vide. */
  right: string;
  /** Son écran (#/gares), ou son ajout quand elle est vide (#/gares/ajouter), comme le toucher dans les lunettes. */
  href: string;
}

/** « Gares de train », « Arrêts de bus, tram, métro », « Lignes de bus, tram, métro » : dans l'ordre des lunettes. */
export function rubrics(s: Settings): Rubric[] {
  const rubric = (kind: PickKind, key: string, qual: string, word: string, hash: string, names: string[]): Rubric => ({
    kind,
    key,
    qual,
    names,
    right: names.length ? counted(names.length, word) : SECTION.empty,
    href: names.length ? hash : `${hash}/ajouter`,
  });
  return [
    rubric('stations', SECTION.stations, SECTION.trainQual, 'gare', '#/gares', s.stations.map((p) => stationTitle(p, s.lang))),
    rubric('lines', SECTION.stops, SECTION.transitQual, 'arrêt', '#/arrets', s.lines.filter((p) => !p.line).map((p) => linePickName(p, s.lang))),
    rubric('follows', SECTION.follows, SECTION.transitQual, 'ligne', '#/lignes', (s.follows ?? []).map((f) => lineName(f))),
  ];
}

/* ------------------------------ Carte « Favoris » ------------------------------ */

/**
 * Carte « Favoris » (S8) : la ligne « Favoris » et leur nombre (#/favoris), dessous jusqu'à 3 favoris dans l'ordre des
 * lunettes, figé tant que l'accueil reste affiché, chacun avec sa réponse courte (rafraîchie toutes les 30 s) et son
 * bouton « Lunettes ». 1.2.9 (relecture) : au-delà de 3, « Voir les 2 autres favoris » les montre de la même façon
 * (rien ne disparaît : en 1.2.8, tous avaient leur bouton « Lunettes ») ; leurs réponses ne sont calculées qu'alors.
 * Sans favori : « Aucun favori » et « Ajouter un favori ».
 */
function favoritesCard(ctx: PhoneCtx): HTMLElement {
  const s = ctx.settings.get();
  const n = shownFavorites(s.favorites).length;
  const list = h('ul', { class: 'list box mirror fav-card' });
  list.appendChild(
    navRow({
      href: '#/favoris',
      icon: h('span', { class: 'ico', html: MIRROR_ICON.star }),
      title: T.favorites,
      right: n ? String(n) : T.noFavShort,
      label: n ? typo(`${T.favorites}, ${counted(n, 'favori')} : ajouter, modifier, changer l’ordre`) : `${T.favorites}, aucun favori`,
    }),
  );
  if (!n) {
    list.appendChild(h('li', { class: 'fav-sub' }, h('a', { class: 'add-link', href: '#/favoris/nouveau' }, svgNode(ICON.plus), h('span', null, T.addFav))));
    return list;
  }
  const hub = messageHub();
  const fix = ctx.location.last();
  const here = fix ? { lat: fix.lat, lon: fix.lon } : null;
  // Ordre figé tant que l'accueil reste affiché (comme les lunettes) ; les premiers (HOME_FAVORITES), les autres sur demande.
  const ordered = orderedFavorites(ctx.coreNow(), s, here);
  const shown = ordered.slice(0, HOME_FAVORITES);
  const rest = ordered.slice(HOME_FAVORITES);
  const rows = new Map<string, { name: HTMLElement; answer: HTMLElement }>();
  const favRow = (f: ShownFavorite): HTMLLIElement => {
    const name = h('span', { class: 't1' }, favoriteTitle(f, s));
    const answer = h('span', { class: 't2 answer' }, typo(shortAnswer(lastAnswers.get(f.id), ctx.clock.now(), s)));
    rows.set(f.id, { name, answer });
    const { button, message } = glassesButton(hub, `Afficher ${favoriteTitle(f, s)} dans les lunettes`, async () => {
      const st = ctx.settings.get();
      const fav = shownFavorites(st.favorites).find((x) => x.id === f.id) ?? f;
      // Jamais une réponse ancienne (retour sur l'accueil plus tard) : les lunettes suivraient un train parti.
      let a = lastAnswers.get(fav.id);
      if (!reusable(a, ctx.clock.now())) {
        const fx = ctx.location.last() ?? (await ctx.location.current(6000));
        a = await (await ctx.core()).answer(fav, fx ? { lat: fx.lat, lon: fx.lon } : null, st);
        lastAnswers.set(fav.id, a);
      }
      const result = a.plan ?? { journeys: [], empty: a.state === 'noPosition' ? ('noPosition' as const) : a.state === 'here' ? ('here' as const) : ('noTrip' as const) };
      // Un lieu : le trajet « Ma position → lieu » (même identifiant).
      const trip = asTrip(fav);
      return showTrip(ctx, { title: favoriteTitle(fav, st), from: trip.from, to: trip.to, favoriteId: fav.id, result, index: 0 });
    });
    return h('li', { class: 'fav-row' }, h('span', { class: 'txt' }, name, answer), button, message);
  };
  for (const f of shown) list.appendChild(favRow(f));
  if (rest.length) {
    const more = h('button', { type: 'button', class: 'add-link more-favs' }, rest.length === 1 ? 'Voir l’autre favori' : `Voir les ${rest.length} autres favoris`);
    const moreRow = h('li', { class: 'fav-sub' }, more);
    more.addEventListener('click', () => {
      const added = rest.map(favRow);
      moreRow.replaceWith(...added);
      shown.push(...rest);
      added[0]?.querySelector<HTMLElement>('button')?.focus();
      void refresh();
    });
    list.appendChild(moreRow);
  }

  let busy = false;
  let first = true;
  const refresh = async (): Promise<void> => {
    // Le premier calcul part avant que le routeur n'attache l'écran ; les suivants s'arrêtent avec lui.
    if (busy || (!first && !list.isConnected)) return;
    first = false;
    busy = true;
    try {
      const core = await ctx.core();
      const fx = ctx.location.last() ?? (await ctx.location.current(6000));
      const pos = fx ? { lat: fx.lat, lon: fx.lon } : null;
      await Promise.all(
        shown.map(async (f) => {
          const st = ctx.settings.get();
          const fav = shownFavorites(st.favorites).find((x) => x.id === f.id);
          if (!fav) return;
          let a: FavoriteAnswer;
          try {
            a = await core.answer(fav, pos, st);
          } catch {
            return;
          }
          lastAnswers.set(fav.id, a);
          const row = rows.get(fav.id);
          if (!row) return;
          row.name.textContent = favoriteTitle(fav, st);
          row.answer.textContent = typo(shortAnswer(a, ctx.clock.now(), st));
        }),
      );
    } catch {
      /* cœur indisponible : les réponses restent « … » */
    } finally {
      busy = false;
    }
  };
  queueMicrotask(() => void refresh());
  const timer = setInterval(() => {
    if (!list.isConnected) clearInterval(timer);
    else void refresh();
  }, ANSWER_REFRESH_MS);
  return list;
}

/* ------------------------------ Carte des rubriques ------------------------------ */

/** Pastilles des lignes suivies, dans leur ordre, à leur couleur officielle (8 au plus, puis « +3 »). */
const MAX_BADGES = 8;
function followBadges(ctx: PhoneCtx, follows: readonly LineFollow[]): HTMLElement {
  const row = h('span', { class: 'badges', 'aria-hidden': 'true' }, follows.slice(0, MAX_BADGES).map((f) => lineBadge(ctx, f, true)));
  if (follows.length > MAX_BADGES) row.append(h('span', { class: 'badge sm more' }, `+${follows.length - MAX_BADGES}`));
  return row;
}

const RUBRIC_ICON: Record<PickKind, () => HTMLElement> = { stations: () => icon('train'), lines: () => icon('pin'), follows: () => icon('trip') };

/** Ligne d'une rubrique : « Gares de train », ses noms (une ligne) ou ses pastilles, « 2 gares » ou « à choisir ». */
function rubricRow(ctx: PhoneCtx, r: Rubric, s: Settings): HTMLLIElement {
  const title: Child = [h('span', { class: 'kw' }, r.key), ' ', h('span', { class: 'qual' }, r.qual)];
  const empty = !r.names.length;
  const badges = !empty && r.kind === 'follows';
  return navRow({
    href: r.href,
    icon: RUBRIC_ICON[r.kind](),
    title,
    sub: empty ? undefined : badges ? followBadges(ctx, s.follows ?? []) : r.names.join(', '),
    subClass: badges ? 'sub-badges' : 'names',
    right: r.right,
    // Les pastilles ne se lisent pas : leurs noms dans celui du lien (« Lignes de bus, tram, métro, 3 lignes : Tram 3, … »).
    label: badges ? typo(`${r.key} ${r.qual}, ${r.right} : ${r.names.join(', ')}`) : undefined,
  });
}

/* ------------------------------ Bannière « Nouveau » ------------------------------ */

/**
 * Bannière « Nouveau » (une fois, PRD-1.2.9 § 2.1) : « Nouveau dans Quai 1.2.9 » sur une ligne, « Voir ce qui change »
 * déplie les nouveautés dans la bannière (aria-expanded), « OK » la ferme pour de bon ; le curseur passe alors à `next`.
 */
function newsBanner(ctx: PhoneCtx, next: () => HTMLElement): HTMLElement | null {
  const news = ctx.news;
  if (!news?.visible()) return null;
  const id = nextId('news');
  const lines = h('div', { class: 'news-lines', id: `${id}-lignes`, hidden: true }, news.lines.map((l) => h('p', null, typo(l))));
  // Le titre et « Voir ce qui change » forment un seul bouton (une cible de 44 px au moins, comme la maquette).
  const more = h(
    'button',
    { type: 'button', class: 'news-more', 'aria-expanded': 'false', 'aria-controls': lines.id },
    h('strong', { class: 'news-title', id: `${id}-titre` }, newsTitle(NEWS_SINCE)),
    h('span', { class: 'news-see' }, T.seeNews, svgNode(MIRROR_ICON.down)),
  );
  more.addEventListener('click', () => {
    const open = lines.hidden;
    lines.hidden = !open;
    more.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  const ok = h('button', { type: 'button', class: 'btn btn-secondary news-ok' }, 'OK');
  const el = h('section', { class: 'news', 'aria-labelledby': `${id}-titre` }, h('div', { class: 'news-head' }, svgNode(MIRROR_ICON.info), more, ok), lines);
  ok.addEventListener('click', () => {
    news.dismiss();
    el.remove();
    const to = next();
    to.tabIndex = -1;
    to.focus();
  });
  return el;
}

/* ------------------------------ Accueil ------------------------------ */

/** 1.2.9 (relecture) : Affichage ouvert depuis l'accueil (« Aperçu », « Autour de moi ») y revient d'un toucher. */
export const AFFICHAGE_FROM_HOME = '#/affichage?retour=accueil';

/** Ce que montre la carte des rubriques : elle n'est redessinée que si cela change. */
const rubricKey = (s: Settings): string => JSON.stringify([s.lang, s.display.radiusM, s.stations, s.lines, s.follows ?? []]);

/**
 * Accueil. `opts.focus` (#/gares, #/arrets, #/lignes tant que leur route mène ici) : ignoré depuis la 1.2.9, les
 * sections ayant quitté l'accueil.
 */
export function homeScreen(ctx: PhoneCtx, _sub: string[] = [], _opts: { focus?: PickKind } = {}): HTMLElement {
  const s = ctx.settings.get();
  const fresh = ctx.freshness();
  // « Où vas-tu ? » ouvre la recherche, curseur dans « Arrivée » (M4.1).
  const where = h(
    'button',
    { type: 'button', class: 'where', onclick: () => ctx.go('#/recherche'), 'aria-label': `${typo(T.where)} ${T.wherePlaceholder}` },
    h('span', { class: 'where-label' }, typo(T.where)),
    h('span', { class: 'where-box', html: `${ICON.searchGrey}<span>${T.wherePlaceholder}</span>` }),
  );
  const heading = h('h2', { id: 'h-miroir' }, T.inGlasses);
  // « Autour de moi » et les trois rubriques ; 1.2.9 (relecture) : une gare, un arrêt ou une ligne gardés ou retirés
  // ailleurs (★ des lunettes, Quai Web côte à côte) : la carte suit
  const rubricList = h('ul', { class: 'list box mirror' });
  const paintRubrics = (st: Settings): void => {
    rubricList.replaceChildren(
      navRow({ href: AFFICHAGE_FROM_HOME, icon: h('span', { class: 'ico', html: MIRROR_ICON.nearby }), title: T.nearby, sub: withinText(st.display.radiusM) }),
      ...rubrics(st).map((r) => rubricRow(ctx, r, st)),
    );
  };
  const mirror = h(
    'section',
    { class: 'mirror-sec', 'aria-labelledby': 'h-miroir' },
    h(
      'div',
      { class: 'sec-head' },
      h('div', { class: 'sec-titles' }, heading, h('p', { class: 'sec-lead' }, T.mirrorLead)),
      h('a', { class: 'sec-link', href: AFFICHAGE_FROM_HOME, 'aria-label': T.previewLabel }, svgNode(MIRROR_ICON.eye), h('span', null, T.preview)),
    ),
    favoritesCard(ctx),
    rubricList,
  );
  paintRubrics(s);
  const el = h(
    'div',
    { class: 'screen home' },
    h(
      'header',
      { class: 'head head-home' },
      h('div', { class: 'head-titles' }, h('span', { class: 'eyebrow' }, 'Quai'), h('h1', null, 'Bonjour')),
      h('a', { class: 'btn btn-secondary head-btn', href: '#/reglages' }, svgNode(ICON.settings), h('span', null, T.settings)),
    ),
    !ctx.configured
      ? h('div', { class: 'warn', role: 'alert' }, h('strong', null, 'Quai n’est pas configuré.'), typo('Les adresses des horaires et du relais manquent : lancez « npm run configure » avant de créer le paquet.'))
      : fresh && !fresh.ok
        ? h('div', { class: 'warn', role: 'alert' }, h('strong', null, typo(fresh.message ?? 'Horaires périmés')), h('a', { href: '#/donnees' }, 'Voir l’écran Données'))
        : null,
    where,
    newsBanner(ctx, () => heading),
    mirror,
  );
  // l'écran quitté, ou jamais posé (le routeur est passé à un autre), la carte ne suit plus
  let drawn = rubricKey(s);
  let seen = false;
  const stop = ctx.settings.subscribe((st) => {
    if (el.isConnected) seen = true;
    else if (seen) {
      stop();
      return;
    }
    const k = rubricKey(st);
    if (k === drawn) return;
    drawn = k;
    paintRubrics(st);
  });
  setTimeout(() => {
    if (el.isConnected) seen = true;
    else if (!seen) stop();
  }, 0);
  return el;
}

/** Pour les tests : oublie les réponses gardées entre deux accueils. */
export function resetAnswers(): void {
  lastAnswers.clear();
}
