/**
 * « Mes favoris » (PRD-1.2 § 2.2) : une seule liste pour les endroits (lieux) et les trajets fixes, dans l'ordre
 * choisi (« Changer l’ordre », S3) ; « Ajouter un favori » (32 au plus) ; en bas, les adresses récentes (S4).
 * 1.2.2 : plus d'arrêt favori (rangés dans « Gares » et « Bus, tram, métro », PRD-1.2.2 § 5) ; la marche maximale
 * est dans « Trajets » (revue d'usage n° 9).
 */
import type { Favorite, FavoritePlace, FavoriteTrip } from '../../core/api';
import { LIMITS } from '../../settings';
import { header, type PhoneCtx } from '../app';
import { h, icon, ICON, liveRegion, svgNode } from '../dom';
import { endpointText, limitText, placeSubtitle, PROPOSE_TEXT, rankText, T, typo } from '../text';
import { listRow } from '../ui';
import { fillAccess, placeIcon } from './places';
import { moveById } from './picks';

/** Favori montré sur le téléphone : un endroit ou un trajet fixe (les réglages v4 n'ont plus d'arrêt favori). */
export type ShownFavorite = FavoritePlace | FavoriteTrip;
export const shownFavorites = (list: readonly Favorite[]): ShownFavorite[] => list.filter((f): f is ShownFavorite => f.kind !== 'stop');

/** Titre d'un favori dans la liste : « Bureau », « Bruxelles-Central → Gand-Saint-Pierre ». */
export function favoriteRowTitle(f: ShownFavorite, ctx: Pick<PhoneCtx, 'settings'>): string {
  const s = ctx.settings.get();
  if (f.kind === 'place') return f.label;
  return `${endpointText(f.from, s)} → ${endpointText(f.to, s)}`;
}

/** Deuxième ligne : adresse du lieu, « Trajet fixe ». */
export function favoriteSubtitle(f: ShownFavorite): string {
  if (f.kind === 'place') return typo(placeSubtitle(f));
  return T.fixedTrip;
}

const favIcon = (f: ShownFavorite): HTMLSpanElement => (f.kind === 'place' ? placeIcon(f.label) : icon('trip'));

/** Déplace le favori `id` d'un rang vers le haut (-1) ou le bas (+1). */
export const moveFavorite = (list: Favorite[], id: string, dir: -1 | 1): Favorite[] => moveById(list, id, dir);

/** Ligne d'un favori : titre, sous-titre, accès d'un lieu, créneau (« en tête le matin »). */
function favoriteRow(ctx: PhoneCtx, f: ShownFavorite): HTMLLIElement {
  const title = favoriteRowTitle(f, ctx);
  const open = (): void => ctx.go(`#/favoris/${encodeURIComponent(f.id)}`);
  const propose = typo(PROPOSE_TEXT[f.propose]) || undefined;
  if (f.kind === 'trip') return listRow({ icon: favIcon(f), title, sub: favoriteSubtitle(f), sub3: propose, label: `Modifier le trajet fixe ${title}`, onClick: open });
  const row = listRow({ icon: favIcon(f), title, sub: favoriteSubtitle(f), sub2: ' ', sub3: propose, label: `Modifier ${title}`, onClick: open });
  const t3 = row.querySelector('.t3');
  if (t3) fillAccess(ctx, t3, f);
  return row;
}

export function favoritesScreen(ctx: PhoneCtx): HTMLElement {
  const list = h('ul', { class: 'list box' });
  const live = liveRegion();
  let ordering = false;
  const reorder = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, T.reorder);
  const add = h('button', { type: 'button', class: 'btn btn-primary btn-block', style: 'min-height:48px', onclick: () => ctx.go('#/favoris/nouveau') }, svgNode(ICON.plusWhite), h('span', null, T.addFav));
  const limit = h('p', { class: 'small muted', role: 'status' });

  const paint = (focus?: { id: string; dir: -1 | 1 }): void => {
    const favorites = shownFavorites(ctx.settings.get().favorites);
    list.replaceChildren();
    list.classList.toggle('ordering', ordering);
    favorites.forEach((f, i) => {
      if (!ordering) {
        list.appendChild(favoriteRow(ctx, f));
        return;
      }
      const title = favoriteRowTitle(f, ctx);
      const move = (dir: -1 | 1) => async () => {
        await ctx.settings.update((x) => ({ ...x, favorites: moveFavorite(x.favorites, f.id, dir) }));
        live.say(typo(rankText(title, i + dir + 1, favorites.length)));
        paint({ id: f.id, dir });
      };
      const up = h('button', { type: 'button', class: 'btn btn-secondary btn-small', 'aria-label': `${T.up} ${title}`, disabled: i === 0, onclick: move(-1) }, T.up);
      const down = h('button', { type: 'button', class: 'btn btn-secondary btn-small', 'aria-label': `${T.down} ${title}`, disabled: i === favorites.length - 1, onclick: move(1) }, T.down);
      list.appendChild(h('li', { class: 'order-row', 'data-id': f.id }, favIcon(f), h('span', { class: 'txt' }, h('span', { class: 't1' }, title), h('span', { class: 't2' }, favoriteSubtitle(f))), h('span', { class: 'order-btns' }, up, down)));
    });
    if (!favorites.length) list.appendChild(h('li', { class: 'small', style: 'padding:14px 16px' }, T.noFav));
    reorder.hidden = favorites.length < 2;
    reorder.textContent = ordering ? T.done : T.reorder;
    reorder.classList.toggle('btn-primary', ordering);
    reorder.classList.toggle('btn-secondary', !ordering);
    const full = favorites.length >= LIMITS.favorites;
    add.hidden = ordering;
    add.disabled = full;
    limit.textContent = full && !ordering ? typo(limitText(LIMITS.favorites)) : '';
    limit.hidden = !limit.textContent;
    if (focus) {
      // Le curseur suit le favori déplacé (même bouton, ou l'autre s'il est désormais grisé).
      const row = list.querySelector<HTMLElement>(`[data-id="${CSS.escape(focus.id)}"]`);
      const btns = row ? [...row.querySelectorAll<HTMLButtonElement>('button')] : [];
      const same = btns[focus.dir < 0 ? 0 : 1];
      (same && !same.disabled ? same : btns.find((b) => !b.disabled))?.focus();
    }
  };
  reorder.addEventListener('click', () => {
    ordering = !ordering;
    live.say('');
    paint();
    if (!ordering) reorder.focus();
  });
  paint();

  const s = ctx.settings.get();
  const recent = s.recent.length
    ? h(
        'section',
        { class: 'box pad', 'aria-labelledby': 'recents' },
        h('h2', { id: 'recents' }, T.recentTitle),
        h('ul', { class: 'plain' }, s.recent.map((r) => h('li', { class: 'small' }, r.label))),
        h('button', {
          type: 'button',
          class: 'btn btn-secondary btn-block',
          onclick: async () => {
            await ctx.settings.update((x) => ({ ...x, recent: [] }));
            ctx.go('#/favoris');
          },
        }, T.clearRecent),
      )
    : null;
  return h('div', { class: 'screen' }, header(ctx, T.myFavs, typo(T.favsLead), { label: 'Accueil', hash: '#/' }), list, reorder, live.el, add, limit, recent);
}
