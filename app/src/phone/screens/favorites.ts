/**
 * Réglage 3 sur 6 : favoris (T4, maquettes Config3 et Favoris) : arrêt avec lignes et directions, ou trajet A → B
 * en champs uniques ; ordre (« Changer l’ordre », S3) ; créneaux avec leurs heures ; suppression confirmée dans la page.
 */
import type { Endpoint, Favorite, FavoriteStop, FavoriteTrip, LineFilter, Mode, Propose, SearchItem } from '../../core/api';
import { OP_NAME, displayName, mainMode } from '../../core/util';
import type { Names, Op } from '../../../../shared/types';
import { LIMITS, newId } from '../../settings';
import { headText } from '../../glasses/format';
import { header, type PhoneCtx } from '../app';
import { debounce, h, icon, ICON, liveRegion } from '../dom';
import { placeField, privacyNote, type FieldChoice } from '../field';
import { endpointText, PROPOSE_LABEL, T, typo } from '../text';
import { confirmInPage, listRow, radios, segmented } from '../ui';

const MODE_TITLE: Record<Mode, string> = { train: 'Train', metro: 'Métro', tram: 'Tram', bus: 'Bus' };
const MODE_PLURAL: Record<Mode, string> = { train: 'trains', metro: 'métros', tram: 'trams', bus: 'bus' };
const PROPOSE_TEXT: Record<Propose, string> = { never: '', near: 'proposé à moins de 300 m', morning: 'proposé le matin', evening: 'proposé le soir' };

/** « Le proposer à l’ouverture » (T4) : créneaux avec leurs heures. */
export const PROPOSE_OPTIONS: { value: Propose; label: string }[] = (['never', 'near', 'morning', 'evening'] as const).map((value) => ({ value, label: typo(PROPOSE_LABEL[value]) }));

/** « trams 3 et 4 » à partir du filtre et du mode. */
export function linesText(lines: string[], mode: Mode | undefined): string {
  const uniq = [...new Set(lines)];
  if (!uniq.length) return mode ? MODE_PLURAL[mode] : '';
  const word = mode ? (uniq.length > 1 ? MODE_PLURAL[mode] : MODE_TITLE[mode].toLowerCase()) : uniq.length > 1 ? 'lignes' : 'ligne';
  const list = uniq.length > 1 ? `${uniq.slice(0, -1).join(', ')} et ${uniq[uniq.length - 1]}` : uniq[0];
  return `${word} ${list}`;
}

/** Sous-titre d'un favori : « Arrêt STIB, trams 3 et 4 », « Trajet porte à porte, proposé le matin ». */
export function favoriteSubtitle(f: Favorite): string {
  if (f.kind === 'stop') {
    const lines = f.filter?.map((x) => x.line) ?? [];
    const mode: Mode | undefined = f.op === 'sncb' ? 'train' : f.op === 'stib' ? undefined : 'bus';
    const what = f.op === 'sncb' ? 'Gare SNCB' : `Arrêt ${OP_NAME[f.op]}`;
    const l = linesText(lines, mode);
    return typo([what + (l ? `, ${l}` : ''), PROPOSE_TEXT[f.propose]].filter(Boolean).join(', '));
  }
  const train = f.from.type === 'area' && f.to.type === 'area' && f.from.op === 'sncb' && f.to.op === 'sncb';
  return typo([train ? 'Trajet en train' : 'Trajet porte à porte', PROPOSE_TEXT[f.propose]].filter(Boolean).join(', '));
}

/** Titre d'un favori dans la liste : « Gare du Nord », « Ma position → Bureau ». */
export function favoriteTitle(f: Favorite, ctx: PhoneCtx): string {
  const s = ctx.settings.get();
  return f.kind === 'stop' ? displayName(f.name, s.lang) : `${endpointText(f.from, s)} → ${endpointText(f.to, s)}`;
}

function favIcon(f: Favorite): HTMLSpanElement {
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

export function favoritesScreen(ctx: PhoneCtx): HTMLElement {
  const list = h('ul', { class: 'list box' });
  const live = liveRegion();
  let ordering = false;
  const reorder = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, T.reorder);
  const add = h('button', { type: 'button', class: 'btn btn-primary btn-block', style: 'min-height:48px', onclick: () => ctx.go('#/favoris/nouveau'), html: `${ICON.plusWhite}<span>Ajouter un arrêt, une gare ou un trajet</span>` });

  const paint = (focus?: { id: string; dir: -1 | 1 }): void => {
    const s = ctx.settings.get();
    list.replaceChildren();
    list.classList.toggle('ordering', ordering);
    s.favorites.forEach((f, i) => {
      const title = favoriteTitle(f, ctx);
      if (!ordering) {
        list.appendChild(listRow({ icon: favIcon(f), title, sub: favoriteSubtitle(f), label: `Modifier ${f.kind === 'stop' ? 'l’arrêt' : 'le trajet'} ${title}`, onClick: () => ctx.go(`#/favoris/${encodeURIComponent(f.id)}`) }));
        return;
      }
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
    add.hidden = ordering;
    add.disabled = s.favorites.length >= LIMITS.favorites;
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
  return h(
    'div',
    { class: 'screen' },
    header(ctx, T.myFavs, T.favsLead, { label: 'Accueil', hash: '#/' }),
    list,
    reorder,
    live.el,
    add,
  );
}

interface AreaPick { areaId: string; op: Op; name: Names; lat: number; lon: number; modes: Mode[]; kindLabel?: string }

/** Champ d'arrêt (favori d'arrêt) : gares et arrêts seulement, avec leur type. */
function stopPicker(ctx: PhoneCtx, opts: { id: string; label: string; value: string; onPick: (a: AreaPick) => void }): HTMLElement {
  const s = ctx.settings.get();
  const input = h('input', { id: opts.id, class: 'input', type: 'search', value: opts.value, autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': `${opts.id}-list`, 'aria-autocomplete': 'list' });
  const list = h('ul', { class: 'suggest', id: `${opts.id}-list`, role: 'listbox', 'aria-label': `${opts.label} : propositions` });
  const option = (label: string, sub: string, pick: () => void): HTMLLIElement =>
    h('li', { role: 'none' }, h('button', { type: 'button', role: 'option', 'aria-selected': 'false', onclick: () => { pick(); list.replaceChildren(); input.setAttribute('aria-expanded', 'false'); } }, h('span', { class: 's1' }, label), h('span', { class: 's2' }, sub)));
  // Numéro de requête : la réponse d'une saisie dépassée (arrivée en retard) est ignorée, jamais mélangée.
  let seq = 0;
  const run = debounce(async () => {
    const my = ++seq;
    const q = input.value.trim();
    let items: SearchItem[] = [];
    if (q.length >= 2) {
      try {
        const core = await ctx.core();
        items = await core.search(q, ctx.location.last() ?? undefined);
      } catch {
        items = []; // recherche indisponible : la liste reste vide
      }
    }
    if (my !== seq) return;
    list.replaceChildren(
      ...items.slice(0, 8).map((it) => {
        const label = displayName(it.n, s.lang);
        return option(label, it.kindLabel, () => {
          input.value = label;
          opts.onPick({ areaId: it.id, op: it.op, name: it.n, lat: it.lat, lon: it.lon, modes: it.modes, kindLabel: it.kindLabel });
        });
      }),
    );
    input.setAttribute('aria-expanded', list.children.length ? 'true' : 'false');
  }, 220);
  input.addEventListener('input', run);
  input.addEventListener('focus', run);
  return h('div', { class: 'field' }, h('label', { for: opts.id }, opts.label), input, list);
}

/** Extrémité d'un trajet favori à partir d'un choix du champ unique. */
export function endpointOf(c: FieldChoice): Endpoint {
  if (c.kind === 'here') return { type: 'here' };
  if (c.kind === 'place') return { type: 'place', placeId: c.place.id };
  if (c.kind === 'address') return c.approx ? { type: 'address', label: c.label, lat: c.lat, lon: c.lon, approx: true } : { type: 'address', label: c.label, lat: c.lat, lon: c.lon };
  return { type: 'area', areaId: c.item.id, op: c.item.op, name: c.item.n, lat: c.item.lat, lon: c.item.lon };
}

export function favoriteEditScreen(ctx: PhoneCtx, id: string): HTMLElement {
  const s = ctx.settings.get();
  const existing = s.favorites.find((f) => f.id === id);
  const isNew = !existing;
  let kind: 'stop' | 'trip' = existing?.kind ?? (ctx.params.get('type') === 'trajet' ? 'trip' : 'stop');
  let propose: Propose = existing?.propose ?? 'never';
  let area: AreaPick | null = existing?.kind === 'stop' ? { areaId: existing.areaId, op: existing.op, name: existing.name, lat: existing.lat, lon: existing.lon, modes: [] } : null;
  let filter: LineFilter[] | undefined = existing?.kind === 'stop' ? existing.filter : undefined;
  let from: Endpoint | null = existing?.kind === 'trip' ? existing.from : { type: 'here' };
  let to: Endpoint | null = existing?.kind === 'trip' ? existing.to : null;
  let label = existing?.kind === 'trip' ? existing.label ?? '' : '';
  const live = liveRegion();
  const body = h('div', { class: 'form-body' });
  const save = h('button', { type: 'button', class: 'btn btn-primary btn-big btn-block' }, 'Enregistrer le favori');
  const linesBox = h('div');

  const sync = (): void => {
    save.disabled = kind === 'stop' ? !area : !from || !to;
  };

  async function loadLines(): Promise<void> {
    linesBox.replaceChildren();
    if (!area) return;
    linesBox.appendChild(h('p', { class: 'small muted' }, 'Chargement des lignes…'));
    try {
      const core = await ctx.core();
      const lines = await core.linesAt(area.areaId);
      if (!area.modes.length && lines.length) {
        area.modes = [...new Set(lines.map((l) => l.mode))];
        const input = body.querySelector<HTMLInputElement>('#fav-arret');
        if (input) input.value = `${displayName(area.name, s.lang)}, ${MODE_TITLE[mainMode(area.modes)].toLowerCase()} (${OP_NAME[area.op]})`;
      }
      const fs = h('fieldset', null, h('legend', { class: 'legend-sm' }, 'Lignes et directions à afficher'));
      const chosen = new Set((filter ?? []).map((f) => `${f.line}|${f.head}`));
      const all = !filter?.length;
      for (const l of lines) {
        const key = `${l.filter.line}|${l.filter.head}`;
        const cb = h('input', { type: 'checkbox', checked: all || chosen.has(key) });
        cb.addEventListener('change', () => {
          const boxes = [...fs.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
          const picked = lines.filter((_, i) => boxes[i]?.checked).map((x) => x.filter);
          filter = picked.length === lines.length || !picked.length ? undefined : picked;
        });
        fs.appendChild(h('label', { class: 'choice compact' }, cb, `${MODE_TITLE[l.mode]} ${l.line} vers ${headText(l.head, s.lang, area.op)}`));
      }
      linesBox.replaceChildren(lines.length ? fs : h('p', { class: 'small muted' }, 'Aucune ligne trouvée pour cet arrêt.'));
    } catch (e) {
      // Zone disparue (M8) : « Arrêt introuvable : choisis-le à nouveau ».
      const text = e instanceof Error && !/introuvable/i.test(e.message) ? e.message : 'Arrêt introuvable : choisis-le à nouveau';
      linesBox.replaceChildren(h('p', { class: 'small', role: 'alert' }, typo(text)));
    }
  }

  const renderBody = (): void => {
    body.replaceChildren();
    if (kind === 'stop') {
      const value = area ? `${displayName(area.name, s.lang)}${area.modes.length ? `, ${MODE_TITLE[mainMode(area.modes)].toLowerCase()} (${OP_NAME[area.op]})` : ` (${OP_NAME[area.op]})`}` : '';
      body.appendChild(stopPicker(ctx, { id: 'fav-arret', label: 'Arrêt ou gare', value, onPick: (a) => { area = a; filter = undefined; void loadLines(); sync(); } }));
      body.appendChild(linesBox);
      if (area) void loadLines();
    } else {
      // Champs unifiés : le choix s'écrit dans le champ (« Bureau », « Ma position », CA-M4.12).
      const st = ctx.settings.get();
      const dep = placeField(ctx, { id: 'fav-de', label: 'Départ', placeholder: T.wherePlaceholder, value: from ? endpointText(from, st) : '', here: true, places: true, recent: true, onPick: (c) => { from = endpointOf(c); sync(); }, onEdit: () => { from = null; sync(); }, onFocus: () => arr.close() });
      const arr = placeField(ctx, { id: 'fav-vers', label: 'Arrivée', placeholder: T.wherePlaceholder, value: to ? endpointText(to, st) : '', here: true, places: true, recent: true, onPick: (c) => { to = endpointOf(c); sync(); }, onEdit: () => { to = null; sync(); }, onFocus: () => dep.close() });
      body.append(dep.el, arr.el, privacyNote());
      const lab = h('input', { id: 'fav-nom', class: 'input', type: 'text', value: label, maxlength: LIMITS.label, placeholder: 'bureau, maison…', autocomplete: 'off' });
      lab.addEventListener('input', () => (label = lab.value));
      body.appendChild(h('div', { class: 'field' }, h('label', { for: 'fav-nom' }, typo('Nom affiché (« Vers le bureau »), facultatif')), lab));
    }
    body.appendChild(radios<Propose>({ legend: 'Le proposer à l’ouverture', options: PROPOSE_OPTIONS, value: propose, onChange: (v) => (propose = v) }));
    sync();
  };

  save.addEventListener('click', async () => {
    const ids = ctx.settings.get().favorites.map((f) => f.id);
    let fav: Favorite;
    if (kind === 'stop') {
      if (!area) return;
      const st: FavoriteStop = { kind: 'stop', id: existing?.id ?? newId('fav', ids), areaId: area.areaId, op: area.op, name: area.name, lat: area.lat, lon: area.lon, propose };
      if (filter?.length) st.filter = filter;
      fav = st;
    } else {
      if (!from || !to) return;
      const tr: FavoriteTrip = { kind: 'trip', id: existing?.id ?? newId('fav', ids), from, to, propose };
      if (label.trim()) tr.label = label.trim();
      fav = tr;
    }
    await ctx.settings.update((x) => ({ ...x, favorites: isNew ? [...x.favorites, fav] : x.favorites.map((f) => (f.id === fav.id ? fav : f)) }));
    live.say('Favori enregistré.');
    ctx.go('#/favoris');
  });

  const kindSeg = segmented<'stop' | 'trip'>({
    legend: 'Type de favori',
    hiddenLegend: true,
    value: kind,
    options: [
      { value: 'stop', label: 'Un arrêt ou une gare' },
      { value: 'trip', label: 'Un trajet de A à B' },
    ],
    onChange: (v) => {
      kind = v;
      renderBody();
    },
  });
  renderBody();
  const del = existing
    ? confirmInPage({
        trigger: 'Supprimer ce favori',
        question: typo(T.removeFav),
        confirm: T.remove,
        cancel: T.cancel,
        onConfirm: async () => {
          await ctx.settings.update((x) => ({ ...x, favorites: x.favorites.filter((f) => f.id !== existing.id) }));
          ctx.go('#/favoris');
        },
      })
    : null;
  return h(
    'div',
    { class: 'screen' },
    header(ctx, isNew ? 'Nouveau favori' : 'Modifier le favori', undefined, { label: 'Favoris', hash: '#/favoris' }),
    isNew ? kindSeg : null,
    body,
    save,
    live.el,
    del,
  );
}
