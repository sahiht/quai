/**
 * « Mes favoris » (PRD-1.2 § 2.2) : une seule liste pour les lieux, les arrêts et les trajets fixes, dans l'ordre
 * choisi (« Changer l’ordre », S3) ; « Ajouter un favori » (32 au plus) ; en bas, la marche maximale et les adresses
 * récentes (S4), venues de « Mes lieux », qui disparaît.
 */
import type { Favorite, FavoritePlace, FavoriteStop, Mode, NameLang } from '../../core/api';
import { areaLabel, displayName } from '../../core/util';
import { LIMITS } from '../../settings';
import { header, type PhoneCtx } from '../app';
import { h, icon, ICON, liveRegion, svgNode } from '../dom';
import { endpointText, limitText, placeSubtitle, PROPOSE_TEXT, T, typo } from '../text';
import { listRow, stepper } from '../ui';
import { fillAccess, placeIcon } from './places';

const MODE_TITLE: Record<Mode, string> = { train: 'Train', metro: 'Métro', tram: 'Tram', bus: 'Bus' };
const MODE_PLURAL: Record<Mode, string> = { train: 'trains', metro: 'métros', tram: 'trams', bus: 'bus' };

/** « trams 3 et 4 », « ligne 3 » à partir des lignes et du mode. */
export function linesText(lines: string[], mode: Mode | undefined): string {
  const uniq = [...new Set(lines)];
  if (!uniq.length) return mode ? MODE_PLURAL[mode] : '';
  const word = mode ? (uniq.length > 1 ? MODE_PLURAL[mode] : MODE_TITLE[mode].toLowerCase()) : uniq.length > 1 ? 'lignes' : 'ligne';
  const list = uniq.length > 1 ? `${uniq.slice(0, -1).join(', ')} et ${uniq[uniq.length - 1]}` : uniq[0];
  return `${word} ${list}`;
}

/** Lignes connues d'un arrêt (core.linesAt), pour nommer le mode. */
type KnownLine = { line: string; mode: Mode };

/** Lignes d'un arrêt favori : « Trams 3 et 4 », « Ligne 71 », ou « Toutes les lignes » (PRD-1.2 § 2.2). */
export function stopLinesText(f: FavoriteStop, known?: KnownLine[]): string {
  const chosen = [...new Set((f.filter ?? []).map((x) => x.line))];
  if (!chosen.length) return T.allLines;
  const modes = new Set(chosen.map((l) => known?.find((k) => k.line === l)?.mode).filter((m): m is Mode => !!m));
  const mode = modes.size === 1 ? [...modes][0] : f.op === 'sncb' ? 'train' : undefined;
  const t = linesText(chosen, mode);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** « Gare du Nord, tram » (1.0) dès que les modes de l'arrêt sont connus ; « Namur, train » pour une gare. */
export function stopTitle(f: FavoriteStop, lang: NameLang, modes?: Mode[]): string {
  if (modes?.length) return areaLabel({ n: f.name, op: f.op, modes }, lang);
  return f.op === 'sncb' ? areaLabel({ n: f.name, op: f.op, modes: ['train'] }, lang) : displayName(f.name, lang);
}

/** Titre d'un favori dans la liste : « Bureau », « Gare du Nord, tram », « Bruxelles-Central → Gand-Saint-Pierre ». */
export function favoriteRowTitle(f: Favorite, ctx: Pick<PhoneCtx, 'settings'>): string {
  const s = ctx.settings.get();
  if (f.kind === 'place') return f.label;
  if (f.kind === 'stop') return stopTitle(f, s.lang);
  return `${endpointText(f.from, s)} → ${endpointText(f.to, s)}`;
}

/** Deuxième ligne : adresse du lieu, lignes de l'arrêt, « Trajet fixe ». */
export function favoriteSubtitle(f: Favorite): string {
  if (f.kind === 'place') return typo(placeSubtitle(f));
  if (f.kind === 'stop') return stopLinesText(f);
  return T.fixedTrip;
}

function favIcon(f: Favorite): HTMLSpanElement {
  if (f.kind === 'place') return placeIcon(f.label);
  if (f.kind === 'trip') return icon('trip');
  if (f.op === 'sncb') return icon('train');
  return icon(f.op === 'stib' ? 'tram' : 'bus');
}

/** Déplace le favori `id` d'un rang vers le haut (-1) ou le bas (+1). */
export function moveFavorite(list: Favorite[], id: string, dir: -1 | 1): Favorite[] {
  const i = list.findIndex((f) => f.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Ligne d'un favori : titre, sous-titre, accès d'un lieu, créneau (« proposé le matin »). */
function favoriteRow(ctx: PhoneCtx, f: Favorite): HTMLLIElement {
  const title = favoriteRowTitle(f, ctx);
  const open = (): void => ctx.go(`#/favoris/${encodeURIComponent(f.id)}`);
  const propose = typo(PROPOSE_TEXT[f.propose]) || undefined;
  if (f.kind === 'place') return placeRow(ctx, f, title, propose, open);
  if (f.kind === 'trip') return listRow({ icon: favIcon(f), title, sub: favoriteSubtitle(f), sub3: propose, label: `Modifier le trajet fixe ${title}`, onClick: open });
  return stopRow(ctx, f, title, propose, open);
}

function placeRow(ctx: PhoneCtx, p: FavoritePlace, title: string, propose: string | undefined, open: () => void): HTMLLIElement {
  const row = listRow({ icon: favIcon(p), title, sub: favoriteSubtitle(p), sub2: ' ', sub3: propose, label: `Modifier ${title}`, onClick: open });
  const t3 = row.querySelector('.t3');
  if (t3) fillAccess(ctx, t3, p);
  return row;
}

function stopRow(ctx: PhoneCtx, f: FavoriteStop, title: string, propose: string | undefined, open: () => void): HTMLLIElement {
  const row = listRow({ icon: favIcon(f), title, sub: favoriteSubtitle(f), sub3: propose, label: `Modifier ${title}`, onClick: open });
  // Modes et lignes de l'arrêt : « Gare du Nord, tram », « Trams 3 et 4 ».
  void ctx
    .core()
    .then((core) => core.linesAt(f.areaId))
    .then((lines) => {
      const t1 = row.querySelector('.t1');
      const t2 = row.querySelector('.t2');
      const better = stopTitle(f, ctx.settings.get().lang, [...new Set(lines.map((l) => l.mode))]);
      if (t1) t1.textContent = better;
      if (t2) t2.textContent = stopLinesText(f, lines);
      row.querySelector('button')?.setAttribute('aria-label', `Modifier ${better}`);
    })
    .catch(() => {
      /* arrêt introuvable ou cœur indisponible : le nom suffit */
    });
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
    const s = ctx.settings.get();
    list.replaceChildren();
    list.classList.toggle('ordering', ordering);
    s.favorites.forEach((f, i) => {
      if (!ordering) {
        list.appendChild(favoriteRow(ctx, f));
        return;
      }
      const title = favoriteRowTitle(f, ctx);
      const move = (dir: -1 | 1) => async () => {
        await ctx.settings.update((x) => ({ ...x, favorites: moveFavorite(x.favorites, f.id, dir) }));
        const rank = i + dir + 1;
        live.say(typo(`${title} : ${rank === 1 ? '1er' : `${rank}e`} sur ${s.favorites.length}.`));
        paint({ id: f.id, dir });
      };
      const up = h('button', { type: 'button', class: 'btn btn-secondary btn-small', 'aria-label': `${T.up} ${title}`, disabled: i === 0, onclick: move(-1) }, T.up);
      const down = h('button', { type: 'button', class: 'btn btn-secondary btn-small', 'aria-label': `${T.down} ${title}`, disabled: i === s.favorites.length - 1, onclick: move(1) }, T.down);
      list.appendChild(h('li', { class: 'order-row', 'data-id': f.id }, favIcon(f), h('span', { class: 'txt' }, h('span', { class: 't1' }, title), h('span', { class: 't2' }, favoriteSubtitle(f))), h('span', { class: 'order-btns' }, up, down)));
    });
    if (!s.favorites.length) list.appendChild(h('li', { class: 'small', style: 'padding:14px 16px' }, T.noFav));
    reorder.hidden = s.favorites.length < 2;
    reorder.textContent = ordering ? T.done : T.reorder;
    reorder.classList.toggle('btn-primary', ordering);
    reorder.classList.toggle('btn-secondary', !ordering);
    const full = s.favorites.length >= LIMITS.favorites;
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
  const walk = h(
    'div',
    { class: 'box' },
    stepper({
      label: T.maxWalk,
      sub: typo(T.maxWalkSub),
      value: s.maxWalkMin,
      min: LIMITS.maxWalkMin[0],
      max: LIMITS.maxWalkMin[1],
      format: (v) => typo(`${v} min`),
      less: 'Réduire la marche maximale',
      more: 'Augmenter la marche maximale',
      onChange: (v) => void ctx.settings.update((x) => ({ ...x, maxWalkMin: v })),
    }),
  );
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
  return h('div', { class: 'screen' }, header(ctx, T.myFavs, typo(T.favsLead), { label: 'Accueil', hash: '#/' }), list, reorder, live.el, add, limit, walk, recent);
}
