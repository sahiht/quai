/**
 * Accueil du téléphone (T1) : champ « Où vas-tu ? » qui ouvre la recherche, « Mes favoris » (endroits et trajets) avec
 * leur réponse courte et un bouton « Lunettes » (S8), puis « Gares » et « Bus, tram, métro » (PRD-1.2.2 § 4),
 * réglages (« Trajets » sous « Position et langue », revue d'usage n° 9), état des données.
 */
import type { Core, FavoriteAnswer, Settings } from '../../core/api';
import { asTrip, favoriteTitle } from '../../core/favorites';
import type { PhoneCtx } from '../app';
import { h, icon, ICON } from '../dom';
import { glassesButton, showTrip } from '../glasses-link';
import { catchable } from '../../glasses/format';
import { shortAnswer, T, tripsSummary, typo } from '../text';
import { listRow, messageHub } from '../ui';
import { shownFavorites, type ShownFavorite } from './favorites';
import { followsSection, linesSection, stationsSection, type PickKind } from './picks';

const LANG_TEXT = { fr: 'Noms en français', nl: 'Noms en néerlandais', local: 'Noms comme sur place' } as const;

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

/** Sous-titre de la ligne « Données » (T1) : panne du temps réel dite juste (M8). */
export function dataSubtitle(ctx: PhoneCtx): string {
  const fresh = ctx.freshness();
  if (!ctx.configured) return 'Appli non configurée';
  if (ctx.coreError()) return 'Connexion à vérifier';
  if (fresh && !fresh.ok) return 'Horaires périmés';
  const rt = ctx.coreNow()?.status?.().rt;
  if (rt === 'down') return T.rtDown;
  if (rt === 'offline') return typo(T.offline);
  return 'Tout est à jour';
}

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

/**
 * Section « Mes favoris » (S8) : réponse courte, bouton « Lunettes », lien « Gérer mes favoris ».
 * `answered` : appelé après chaque rafraîchissement des réponses (l'état du temps réel est alors connu).
 */
function favoritesSection(ctx: PhoneCtx, answered?: () => void): HTMLElement {
  const s = ctx.settings.get();
  const hub = messageHub();
  const fix = ctx.location.last();
  const here = fix ? { lat: fix.lat, lon: fix.lon } : null;
  const list = h('ul', { class: 'list box fav-list' });
  const section = h('section', { class: 'home-favs', 'aria-labelledby': 'h-favs' }, h('h2', { id: 'h-favs' }, T.myFavs), list, h('a', { class: 'more-link', href: '#/favoris' }, T.manageFavs));
  if (!shownFavorites(s.favorites).length) {
    list.appendChild(h('li', { class: 'small empty-row' }, T.noFav));
    return section;
  }
  // Ordre figé tant que l'accueil reste affiché (comme les lunettes).
  const order = orderedFavorites(ctx.coreNow(), s, here);
  const rows = new Map<string, { name: HTMLElement; answer: HTMLElement }>();
  for (const f of order) {
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
    list.appendChild(h('li', { class: 'fav-row' }, h('span', { class: 'txt' }, name, answer), button, message));
  }

  let busy = false;
  let first = true;
  const refresh = async (): Promise<void> => {
    // Le premier calcul part avant que le routeur n'attache l'écran ; les suivants s'arrêtent avec lui.
    if (busy || (!first && !section.isConnected)) return;
    first = false;
    busy = true;
    try {
      const core = await ctx.core();
      const fx = ctx.location.last() ?? (await ctx.location.current(6000));
      const pos = fx ? { lat: fx.lat, lon: fx.lon } : null;
      await Promise.all(
        order.map(async (f) => {
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
      answered?.();
    }
  };
  queueMicrotask(() => void refresh());
  const timer = setInterval(() => {
    if (!section.isConnected) clearInterval(timer);
    else void refresh();
  }, ANSWER_REFRESH_MS);
  return section;
}

/**
 * Accueil. `focus` (#/gares, #/lignes, PRD-1.2.2 § 1.3 et § 4) : le titre de cette section reçoit le curseur et la
 * page la montre.
 */
export function homeScreen(ctx: PhoneCtx, _sub: string[] = [], opts: { focus?: PickKind } = {}): HTMLElement {
  const s = ctx.settings.get();
  const fresh = ctx.freshness();
  const n = shownFavorites(s.favorites).length;
  const dataRow = listRow({ icon: icon('data'), title: 'Données', sub: dataSubtitle(ctx), onClick: () => ctx.go('#/donnees') });
  // Bannière « Nouveau » (PRD-1.2.1 § 6) : une ligne par nouveauté, « OK » dessous.
  const banner = ctx.news?.visible()
    ? h(
        'div',
        { class: 'news', role: 'status' },
        h('div', { class: 'news-lines' }, ctx.news.lines.map((l) => h('p', null, typo(l)))),
        h('button', {
          type: 'button',
          class: 'btn btn-secondary',
          onclick: (e: Event) => {
            ctx.news?.dismiss();
            (e.currentTarget as HTMLElement).closest('.news')?.remove();
          },
        }, 'OK'),
      )
    : null;
  // « Où vas-tu ? » ouvre la recherche, curseur dans « Arrivée » (M4.1).
  const where = h(
    'button',
    { type: 'button', class: 'where', onclick: () => ctx.go('#/recherche'), 'aria-label': `${typo(T.where)} ${T.wherePlaceholder}` },
    h('span', { class: 'where-label' }, typo(T.where)),
    h('span', { class: 'where-box', html: `${ICON.searchGrey}<span>${T.wherePlaceholder}</span>` }),
  );
  const el = h(
    'div',
    { class: 'screen home' },
    h('header', { class: 'head' }, h('span', { class: 'eyebrow' }, 'Quai'), h('h1', null, 'Bonjour'), h('p', { class: 'lead' }, ctx.web ? 'Les départs en direct s’affichent dans l’onglet Lunettes.' : 'Les départs en direct s’affichent dans tes lunettes.')),
    banner,
    !ctx.configured
      ? h('div', { class: 'warn', role: 'alert' }, h('strong', null, 'Quai n’est pas configuré.'), typo('Les adresses des horaires et du relais manquent : lancez « npm run configure » avant de créer le paquet.'))
      : fresh && !fresh.ok
        ? h('div', { class: 'warn', role: 'alert' }, h('strong', null, typo(fresh.message ?? 'Horaires périmés')), h('a', { href: '#/donnees' }, 'Voir l’écran Données'))
        : null,
    where,
    favoritesSection(ctx, () => {
      const sub = dataRow.querySelector('.t2');
      if (sub) sub.textContent = dataSubtitle(ctx);
    }),
    stationsSection(ctx, opts.focus === 'stations'),
    linesSection(ctx, opts.focus === 'lines'),
    followsSection(ctx, opts.focus === 'follows'),
    h('h2', null, 'Réglages'),
    h(
      'ul',
      { class: 'list box', style: 'background:#fff' },
      listRow({ icon: icon('lang'), title: 'Position et langue', sub: LANG_TEXT[s.lang], onClick: () => ctx.go('#/bienvenue') }),
      listRow({ icon: icon('walker'), title: T.trips, sub: typo(tripsSummary(s.maxWalkMin, s.alerts.leaveBeforeMin)), onClick: () => ctx.go('#/trajets') }),
      listRow({ icon: icon('trip'), title: T.myFavs, sub: n ? `${n} favori${n > 1 ? 's' : ''}` : 'Aucun favori', onClick: () => ctx.go('#/favoris') }),
      listRow({ icon: icon('display'), title: 'Affichage', sub: typo(`Rayon ${s.display.radiusM} m`), onClick: () => ctx.go('#/affichage') }),
      listRow({ icon: icon('alert'), title: 'Alertes', sub: alertsSummary(s.alerts), onClick: () => ctx.go('#/alertes') }),
      dataRow,
    ),
    h('p', { class: 'foot' }, 'Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company'),
  );
  // L'état du temps réel change : le sous-titre de « Données » suit (toutes les 30 s, comme les réponses).
  const sub = dataRow.querySelector('.t2');
  const timer = setInterval(() => {
    if (!el.isConnected) clearInterval(timer);
    else if (sub) sub.textContent = dataSubtitle(ctx);
  }, ANSWER_REFRESH_MS);
  return el;
}

function alertsSummary(a: { platform: boolean; delay: boolean; cancel: boolean; leave: boolean; works: boolean }): string {
  const on = [a.platform && 'voie', a.delay && 'retard', a.cancel && 'suppression', a.leave && 'départ à pied', a.works && 'travaux'].filter(Boolean) as string[];
  if (!on.length) return 'Aucune alerte';
  const t = on.join(', ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Pour les tests : oublie les réponses gardées entre deux accueils. */
export function resetAnswers(): void {
  lastAnswers.clear();
}
