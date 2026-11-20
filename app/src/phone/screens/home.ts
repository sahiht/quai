/**
 * Accueil du téléphone (T1). 1.2.9 (PRD-1.2.9 § 2.1, piste C « Le miroir des lunettes ») : en-tête « Bonjour » et
 * bouton « Réglages » (#/reglages) ; alertes « Quai n’est pas configuré » et « Horaires périmés » ; « Où vas-tu ? »
 * (la recherche) ; bannière « Nouveau » sur une ligne, les nouveautés dépliées à la demande ; « Dans tes lunettes » :
 * les rubriques de l'accueil des lunettes, mêmes mots, même ordre, une ligne chacune qui ouvre son écran. « Favoris »
 * et, en retrait, jusqu'à 3 favoris dans l'ordre des lunettes, chacun avec sa réponse courte et son bouton « Lunettes »
 * (S8) ; « Autour de moi » ; « Gares de train », « Arrêts de bus, tram, métro », « Lignes de bus, tram, métro », leur
 * contenu à droite ou « à choisir » (le toucher ouvre alors l'ajout). Les autres réglages sont dans Réglages.
 * 1.2.10 (PRD-1.2.10 § 4.2 et § 4.3) : « Y aller » sur chaque favori (le bouton « Lunettes » devient alors son icône) ;
 * carte « En cours » en tête pendant un trajet suivi, mise à jour en direct, avec « Arrêter le guidage ».
 * 1.3.0 : la carte « En cours » montre aussi les problèmes de la vérification (PRD-1.3.0 § 6.3) ; bannière « Nouveau »
 * de la 1.3.0 (§ 9).
 * 1.3.1 (PRD-1.3.1 § 8) : l'ordre des lunettes : « Autour de moi », « Favoris » et ses favoris, « Gares de train »,
 * « Lignes de bus, tram, métro », « Arrêts de bus, tram, métro » ; « Où vas-tu ? » reste en haut. § 12 : chaque favori
 * porte le nom de l'accueil des lunettes (L7 : « Bureau », pas « Vers le bureau ») et le même « ! » quand il a un souci
 * (B15) ; noms des données avec l'apostrophe typographique (§ 7).
 */
import type { Core, FavoriteAnswer, GlassesApi, Journey, Settings } from '../../core/api';
import type { GuideStatus } from '../../core/guide-types';
import { asTrip, favoriteTitle } from '../../core/favorites';
import type { LineFollow } from '../../core/linerun';
import { apos } from '../../core/typo';
import { NEWS_SINCE, type PhoneCtx } from '../app';
import { lineBadge } from '../badges';
import { h, icon, ICON, svgNode, type Child } from '../dom';
import { canGo, glassesButton, goButton, goFavorite, showTrip } from '../glasses-link';
import { catchable, SECTION, troubleText, upcoming } from '../../glasses/format';
import { favoriteTrouble, HOME_FAVORITES, homeFavoriteName, TROUBLE_MARK } from '../../glasses/views';
import { arrivalCopyText, checkLinesOf, copiedText, counted, guideNowLine, guideTitleLine, lineName, newsTitle, shortAnswer, T, typo, withinText } from '../text';
import { copyText, messageHub, MIRROR_ICON, navRow, nextId } from '../ui';
import { shownFavorites, type ShownFavorite } from './favorites';
import { linePickName, stationTitle, type PickKind, completeLater } from './picks';

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

/**
 * « Gares de train », « Lignes de bus, tram, métro », « Arrêts de bus, tram, métro » : dans l'ordre des lunettes (1.3.1,
 * PRD-1.3.1 § 8 : les lignes avant les arrêts ; « Autour de moi » et « Favoris » viennent avant elles).
 */
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
    rubric('stations', SECTION.stations, SECTION.trainQual, 'gare', '#/gares', s.stations.map((p) => apos(stationTitle(p, s.lang)))),
    rubric('follows', SECTION.follows, SECTION.transitQual, 'ligne', '#/lignes', (s.follows ?? []).map((f) => apos(lineName(f)))),
    rubric('lines', SECTION.stops, SECTION.transitQual, 'arrêt', '#/arrets', s.lines.filter((p) => !p.line).map((p) => apos(linePickName(p, s.lang)))),
  ];
}

/**
 * 1.3.1 (PRD-1.3.1 § 12, L7 et B15) : nom d'un favori sur l'accueil du téléphone, celui de l'accueil des lunettes
 * (homeFavoriteName : le nom du lieu, « Bureau » et pas « Vers le bureau » ; le titre d'un trajet fixe), avec
 * l'apostrophe typographique (§ 7), suivi du même « ! » que les lunettes quand le favori a un souci (favoriteTrouble :
 * premier véhicule supprimé, voie modifiée, travaux ; jamais un simple retard), collé au nom (TROUBLE_MARK).
 */
export function homeFavoriteText(f: ShownFavorite, a: FavoriteAnswer | undefined, now: number, s: Settings): string {
  const name = apos(homeFavoriteName({ fav: f, ...(a ? { answer: a } : {}) }, { now, settings: s }));
  return favoriteTrouble(a, now) ? `${name}${TROUBLE_MARK}` : name;
}

/**
 * 1.3.1 (PRD-1.3.1 § 12, B15, contrôle du téléphone) : le souci d'un favori, en mots, pour qui ne voit pas le « ! » (un
 * lecteur d'écran ne dit pas un signe seul) : exactement les mots des lunettes (troubleText : « IC supprimé », « voie 6
 * au lieu de 4 », « voie modifiée », le texte de l'alerte de travaux), aucun mot nouveau ; un arrêt favori : son
 * prochain départ, avec les mêmes mots. Pas de souci (ou pas de réponse) : ''.
 */
export function homeFavoriteTrouble(a: FavoriteAnswer | undefined, now: number): string {
  if (!a || !favoriteTrouble(a, now)) return '';
  if (a.kind === 'stop') {
    const d = upcoming(a.board?.departures ?? [], now)[0];
    if (!d) return '';
    const ride = { kind: 'ride', op: d.op, mode: d.mode, line: d.line, cancelled: d.cancelled, platform: d.platform, newPlatform: d.newPlatform };
    return apos(troubleText({ legs: [ride], alerts: [] } as unknown as Journey));
  }
  const j = a.plan?.journeys[0];
  return j ? apos(troubleText(j)) : '';
}

/* ------------------------------ Carte « Favoris » ------------------------------ */

/**
 * Carte « Favoris » (S8) : la ligne « Favoris » et leur nombre (#/favoris), dessous jusqu'à 3 favoris dans l'ordre des
 * lunettes, figé tant que l'accueil reste affiché, chacun avec sa réponse courte (rafraîchie toutes les 30 s) et son
 * bouton « Lunettes ». 1.2.9 (relecture) : au-delà de 3, « Voir les 2 autres favoris » les montre de la même façon
 * (rien ne disparaît : en 1.2.8, tous avaient leur bouton « Lunettes ») ; leurs réponses ne sont calculées qu'alors.
 * Sans favori : « Aucun favori » et « Ajouter un favori ». 1.2.10 : « Y aller » après « Lunettes » (son icône seule,
 * pour que le nom garde sa place), un seul message par favori, à côté de ses boutons.
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
  const rows = new Map<string, { name: HTMLElement; trouble: HTMLElement; answer: HTMLElement }>();
  /** 1.3.1 (B15) : le souci dit en mots, caché à l'écran (le « ! » le montre), juste après le nom. */
  const sayTrouble = (el: HTMLElement, a: FavoriteAnswer | undefined): void => {
    const words = homeFavoriteTrouble(a, ctx.clock.now());
    el.textContent = words;
    el.hidden = !words;
  };
  const go = canGo(ctx);
  const favRow = (f: ShownFavorite): HTMLLIElement => {
    // 1.3.1 (L7) : le nom de l'accueil des lunettes, sans le « ! » dans le nom des boutons
    const title = apos(homeFavoriteName({ fav: f }, { now: ctx.clock.now(), settings: s }));
    const known = lastAnswers.get(f.id);
    const nameEl = h('span', { class: 't1' }, homeFavoriteText(f, known, ctx.clock.now(), s));
    const trouble = h('span', { class: 'sr-only fav-trouble' });
    sayTrouble(trouble, known);
    // le nom, puis son souci en mots (caché) : ensemble dans la rangée, dont la ligne ne change pas (R2 la complète)
    const name: Child = [nameEl, trouble];
    const answer = h('span', { class: 't2 answer' }, typo(shortAnswer(known, ctx.clock.now(), s)));
    rows.set(f.id, { name: nameEl, trouble, answer });
    const { button, message } = glassesButton(hub, `Afficher ${title} dans les lunettes`, async () => {
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
    }, { compact: go });
    // « Lunettes » d'abord, « Y aller » au bout de la rangée : même message, à côté d'eux
    const actions = h('span', { class: 'fav-actions' }, button, go ? goButton(hub, message, typo(`${T.goThere} : ${title}`), () => goFavorite(ctx, f.id)) : null);
    return h('li', { class: 'fav-row' }, h('span', { class: 'txt' }, name, answer), actions, message);
  };
  for (const f of shown) list.appendChild(favRow(f));
  if (rest.length) {
    const more = h('button', { type: 'button', class: 'add-link more-favs' }, rest.length === 1 ? 'Voir l’autre favori' : `Voir les ${rest.length} autres favoris`);
    const moreRow = h('li', { class: 'fav-sub' }, more);
    more.addEventListener('click', () => {
      const added = rest.map(favRow);
      moreRow.replaceWith(...added);
      shown.push(...rest);
      // le curseur sur le premier bouton du premier favori ajouté (« Lunettes »)
      added[0]?.querySelector<HTMLElement>('button')?.focus();
      // un calcul en cours ne connaît pas les favoris ajoutés : un autre le suit (sinon « … » jusqu'au suivant, 30 s)
      if (busy) again = true;
      void refresh();
    });
    list.appendChild(moreRow);
  }

  let busy = false;
  let again = false;
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
          row.name.textContent = homeFavoriteText(fav, a, ctx.clock.now(), st);
          sayTrouble(row.trouble, a);
          row.answer.textContent = typo(shortAnswer(a, ctx.clock.now(), st));
        }),
      );
    } catch {
      /* cœur indisponible : les réponses restent « … » */
    } finally {
      busy = false;
      if (again) {
        again = false;
        void refresh();
      }
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

/* ------------------------------ Carte « En cours » (1.2.10) ------------------------------ */

/**
 * Ce qui suit l'accueil (réglages, guidage) s'arrête quand `el` quitte la page, ou n'y a jamais été posé (le routeur est
 * passé à un autre écran) : à l'appel suivant de `alive()`, au plus tard au contrôle des 30 s. Avant d'être posé,
 * `alive()` est vrai (le routeur attend l'écran).
 */
function whileShown(el: HTMLElement, stop: () => void): () => boolean {
  let seen = false;
  let ended = false;
  const end = (): void => {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    stop();
  };
  const timer = setInterval(() => {
    if (!el.isConnected) end();
  }, ANSWER_REFRESH_MS);
  setTimeout(() => {
    if (el.isConnected) seen = true;
    else if (!seen) end();
  }, 0);
  return () => {
    if (el.isConnected) seen = true;
    else if (seen) end();
    return !ended;
  };
}

/** L'état des lunettes ne doit jamais empêcher l'accueil de s'afficher : une erreur vaut `fallback` (rien de suivi). */
function safe<R>(f: () => R, fallback: R): R {
  try {
    return f();
  } catch {
    return fallback;
  }
}

/**
 * 1.2.10 (PRD-1.2.10 § 4.3) : carte « En cours » en tête de l'accueil pendant un trajet suivi : « En cours » ; « Bureau,
 * arrivée 08:54 » ; « Maintenant : bus 6 vers Gare des Guillemins » (GuideStatus.now, annoncé quand il change) ;
 * « Arrêter le guidage », ou « Arrêter le suivi » quand le guidage est éteint (rien n'est alors guidé). Mise à jour en
 * direct (onGuide) ; elle disparaît quand plus aucun trajet n'est suivi, et revient avec le suivant. Après un arrêt,
 * « Guidage arrêté. » à sa place, qui reçoit le curseur ; disparue alors que le curseur y était : le titre de l'accueil
 * le reçoit. Lunettes sans guidage (appli plus ancienne) : rien.
 * 1.3.0 (PRD-1.3.0 § 6.3) : sous « Maintenant », les problèmes de la vérification en cours (GuideStatus.check, lignes de
 * checkLines : « Lunettes : 12 % de batterie »), deux au plus, annoncés quand ils changent ; aucun : rien.
 */
function nowCard(ctx: PhoneCtx, home: () => HTMLElement | null): HTMLElement {
  const slot = h('div', { class: 'now-slot' });
  const g: GlassesApi | null = ctx.glasses();
  if (!g?.guideStatus && !g?.onGuide) return slot;
  const id = nextId('en-cours');
  const trip = h('p', { class: 'now-trip' });
  const now = h('p', { class: 'now-now', 'aria-live': 'polite' });
  const checks = h('div', { class: 'now-checks', 'aria-live': 'polite', hidden: true });
  const stop = g.stopGuide ? h('button', { type: 'button', class: 'btn btn-secondary now-stop' }, T.stopGuide) : null;
  const msg = h('p', { class: 'msg', role: 'status' });
  // 1.3.1 (R6) : « Copier mon heure d’arrivée », après « Arrêter le guidage » ; son message dessous
  const copy = h('button', { type: 'button', class: 'btn btn-secondary now-copy', hidden: true }, T.copyArrival);
  const copySaid = h('span', null);
  const copyValue = h('span', { class: 'now-copied-text' });
  const copyMsg = h('p', { class: 'msg now-copied', role: 'status', 'aria-atomic': 'true', hidden: true }, copySaid, copyValue);
  const card = h('section', { class: 'now-card', 'aria-labelledby': `${id}-titre` }, h('h2', { class: 'now-title', id: `${id}-titre` }, T.nowTitle), trip, now, checks, stop, msg, copy, copyMsg);
  const done = h('p', { class: 'msg now-done', role: 'status', tabindex: '-1' });
  let guided = true;
  let checked = '';
  /** 1.3.1 (R6) : le texte à copier, d'après le dernier état (« J’arrive vers 08:54. ») ; '' : pas d'heure, pas de bouton. */
  let arrival = '';
  /** 1.3.0 : les lignes de la vérification, redessinées seulement quand elles changent (pas d'annonce répétée). */
  const paintChecks = (st: GuideStatus): void => {
    const lines = checkLinesOf(st);
    const key = lines.join('\n');
    if (key === checked) return;
    checked = key;
    checks.replaceChildren(...lines.map((l) => h('p', { class: 'now-check' }, l)));
    checks.hidden = !lines.length;
  };
  const show = (st: GuideStatus | null): void => {
    if (!st) {
      if (card.parentNode !== slot) return;
      const focused = card.contains(document.activeElement);
      card.remove();
      const title = focused ? home()?.querySelector<HTMLElement>('h1') : null;
      if (title) {
        title.tabIndex = -1;
        title.focus();
      }
      return;
    }
    guided = st.guided !== false;
    trip.textContent = typo(guideTitleLine(st));
    const line = guideNowLine(st);
    if (now.textContent !== line) now.textContent = line;
    now.hidden = !line;
    paintChecks(st);
    if (stop) stop.textContent = guided ? T.stopGuide : T.stopFollow;
    arrival = arrivalCopyText(st);
    copy.hidden = !arrival;
    if (card.parentNode !== slot) {
      msg.textContent = '';
      msg.classList.remove('err');
      copyMsg.hidden = true;
      copySaid.textContent = '';
      copyValue.textContent = '';
      slot.replaceChildren(card);
    }
  };
  /** Une copie en cours ignore un second toucher (le bouton n'est jamais grisé : le curseur y reste). */
  let copying = false;
  /**
   * 1.3.1 (PRD-1.3.1 § 14, R6) : « Copier mon heure d’arrivée » : « J’arrive vers 08:54. » dans le presse-papiers, comme
   * « Copier » du journal (copyText, avec son repli), puis « Copié : J’arrive vers 08:54. ». Copie impossible : le texte,
   * écrit dans le message, est sélectionné pour le menu du téléphone. Rien n'est envoyé.
   */
  copy.addEventListener('click', async () => {
    const text = arrival;
    if (!text || copying) return;
    copying = true;
    copyMsg.classList.remove('err');
    copySaid.textContent = '';
    copyValue.textContent = text;
    copyMsg.hidden = false;
    try {
      const ok = await copyText(text, copyValue);
      copySaid.textContent = ok ? copiedText('') : `${typo(T.journalCopyManual)} `;
      copyMsg.classList.toggle('err', !ok);
    } finally {
      copying = false;
    }
  });
  stop?.addEventListener('click', async () => {
    stop.disabled = true;
    msg.textContent = '';
    msg.classList.remove('err');
    const said = guided ? T.guideStopped : T.followStopped;
    try {
      await g.stopGuide!();
      const st = safe(() => g.guideStatus?.() ?? null, null);
      show(st);
      if (!st) {
        done.textContent = said;
        slot.replaceChildren(done);
        done.focus();
      }
    } catch (e) {
      msg.textContent = typo(e instanceof Error && e.message ? e.message : T.glassesOff);
      msg.classList.add('err');
    } finally {
      stop.disabled = false;
    }
  });
  show(safe(() => g.guideStatus?.() ?? null, null));
  const alive = whileShown(slot, () => off?.());
  const off = safe(
    () =>
      g.onGuide?.((st) => {
        if (alive()) show(st);
      }),
    undefined,
  );
  return slot;
}

/* ------------------------------ Accueil ------------------------------ */

/** 1.2.9 (relecture) : Affichage ouvert depuis l'accueil (« Aperçu », « Autour de moi ») y revient d'un toucher. */
export const AFFICHAGE_FROM_HOME = '#/affichage?retour=accueil';

/** Ce que montre la carte des rubriques : elle n'est redessinée que si cela change. */
const rubricKey = (s: Settings): string => JSON.stringify([s.lang, s.display.radiusM, s.stations, s.lines, s.follows ?? []]);

/** Accueil (#/, et toute ancre inconnue). */
export function homeScreen(ctx: PhoneCtx): HTMLElement {
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
  // 1.3.1 (PRD-1.3.1 § 8) : l'ordre des lunettes, « Autour de moi » en tête, puis « Favoris », puis les trois rubriques ;
  // 1.2.9 (relecture) : une gare, un arrêt ou une ligne gardés ou retirés ailleurs (★ des lunettes, Quai Web côte à
  // côte) : les cartes suivent
  const nearbyList = h('ul', { class: 'list box mirror nearby-card' });
  const rubricList = h('ul', { class: 'list box mirror' });
  const paintRubrics = (st: Settings): void => {
    // 1.2.9 (relecture) : une ligne reprise de la 1.2.5, pas encore complétée (« Ligne 3 ») : l'accueil la complète, comme
    // en 1.2.8 ; la carte suit alors (« Tram 3 »)
    for (const f of st.follows ?? []) if (!f.routes.length) void completeLater(ctx, f);
    nearbyList.replaceChildren(navRow({ href: AFFICHAGE_FROM_HOME, icon: h('span', { class: 'ico', html: MIRROR_ICON.nearby }), title: T.nearby, sub: withinText(st.display.radiusM) }));
    rubricList.replaceChildren(...rubrics(st).map((r) => rubricRow(ctx, r, st)));
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
    nearbyList,
    favoritesCard(ctx),
    rubricList,
  );
  paintRubrics(s);
  const el: HTMLElement = h(
    'div',
    { class: 'screen home' },
    h(
      'header',
      { class: 'head head-home' },
      h('div', { class: 'head-titles' }, h('span', { class: 'eyebrow' }, 'Quai'), h('h1', null, 'Bonjour')),
      h('a', { class: 'btn btn-secondary head-btn', href: '#/reglages' }, svgNode(ICON.settings), h('span', null, T.settings)),
    ),
    // 1.2.10 : « En cours » en tête, pendant un trajet suivi
    nowCard(ctx, () => el),
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
  const alive = whileShown(el, () => stop());
  const stop = ctx.settings.subscribe((st) => {
    if (!alive()) return;
    const k = rubricKey(st);
    if (k === drawn) return;
    drawn = k;
    paintRubrics(st);
  });
  return el;
}

/** Pour les tests : oublie les réponses gardées entre deux accueils. */
export function resetAnswers(): void {
  lastAnswers.clear();
}
