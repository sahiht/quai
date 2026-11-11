/**
 * Ajout et modification d'un favori (PRD-1.2 § 2.2).
 *  - « Nouveau favori » : un seul champ « Adresse, gare ou arrêt », avec en tête « Ma position actuelle ». Une adresse
 *    ou la position donne un lieu ; une gare ou un arrêt, au choix « Ses prochains départs » (un arrêt) ou « Le trajet
 *    pour y aller » (un lieu « Près de {arrêt} ») ; lien « Un trajet fixe, d’un endroit à un autre ».
 *  - Arrêt : lignes et directions, créneau (1.1). Trajet fixe : « Départ » (jamais « Ma position »), « Arrivée », nom
 *    affiché, créneau (1.1). Lieu : voir places.ts.
 *  - Suppression confirmée dans la page.
 */
import type { Endpoint, Favorite, FavoriteStop, FavoriteTrip, LineFilter, Mode, NameLang, Propose, SearchItem } from '../../core/api';
import { OP_NAME, displayName, mainMode } from '../../core/util';
import type { Names, Op } from '../../../../shared/types';
import { LIMITS, newId } from '../../settings';
import { headText } from '../../glasses/format';
import { header, type PhoneCtx } from '../app';
import { debounce, h, liveRegion } from '../dom';
import { placeField, privacyNote, type FieldChoice } from '../field';
import { endpointText, limitText, PROPOSE_LABEL, sameEndpoint, shortAddress, T, typo } from '../text';
import { confirmInPage, radios } from '../ui';
import { favoritesScreen } from './favorites';
import { hereSpot, placeForm, spotOf, type Spot } from './places';

const MODE_TITLE: Record<Mode, string> = { train: 'Train', metro: 'Métro', tram: 'Tram', bus: 'Bus' };
const BACK = { label: T.myFavs, hash: '#/favoris' };

/** « Le proposer à l’ouverture » d'un arrêt ou d'un trajet fixe (1.1) : quatre créneaux avec leurs heures. */
export const PROPOSE_OPTIONS: { value: Propose; label: string }[] = (['never', 'near', 'morning', 'evening'] as const).map((value) => ({ value, label: typo(PROPOSE_LABEL[value]) }));

/** Arrêt choisi (gare ou arrêt), avec ses modes s'ils sont connus. */
interface AreaPick { areaId: string; op: Op; name: Names; lat: number; lon: number; modes: Mode[] }

const areaOfItem = (it: SearchItem): AreaPick => ({ areaId: it.id, op: it.op, name: it.n, lat: it.lat, lon: it.lon, modes: it.modes });

/** Extrémité d'un trajet fixe à partir d'un choix du champ unique. */
export function endpointOf(c: FieldChoice): Endpoint {
  if (c.kind === 'here') return { type: 'here' };
  if (c.kind === 'place') return { type: 'place', placeId: c.place.id };
  if (c.kind === 'address') return c.approx ? { type: 'address', label: c.label, lat: c.lat, lon: c.lon, approx: true } : { type: 'address', label: c.label, lat: c.lat, lon: c.lon };
  return { type: 'area', areaId: c.item.id, op: c.item.op, name: c.item.n, lat: c.item.lat, lon: c.item.lon };
}

/** Ajoute un favori (fin de liste) ou le remplace (même identifiant) ; null si la limite des 32 est atteinte. */
export function withFavorite(list: Favorite[], fav: Favorite): Favorite[] | null {
  if (list.some((f) => f.id === fav.id)) return list.map((f) => (f.id === fav.id ? fav : f));
  return list.length >= LIMITS.favorites ? null : [...list, fav];
}

/* ------------------------------ Arrêt ------------------------------ */

/** Champ d'arrêt (modification d'un arrêt favori) : gares et arrêts seulement, avec leur type. */
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
          opts.onPick(areaOfItem(it));
        });
      }),
    );
    input.setAttribute('aria-expanded', list.children.length ? 'true' : 'false');
  }, 220);
  input.addEventListener('input', run);
  input.addEventListener('focus', run);
  return h('div', { class: 'field' }, h('label', { for: opts.id }, opts.label), input, list);
}

/** Nom d'un arrêt dans son champ : « Gare du Nord, tram (STIB) ». */
const areaText = (a: AreaPick, lang: NameLang): string =>
  `${displayName(a.name, lang)}${a.modes.length ? `, ${MODE_TITLE[mainMode(a.modes)].toLowerCase()} (${OP_NAME[a.op]})` : ` (${OP_NAME[a.op]})`}`;

/**
 * Formulaire d'un arrêt favori (1.1) : lignes et directions, créneau, « Enregistrer ». En modification : le champ
 * de l'arrêt et la suppression.
 */
function stopForm(ctx: PhoneCtx, o: { existing?: FavoriteStop; area?: AreaPick }): HTMLElement {
  const s = ctx.settings.get();
  const existing = o.existing;
  let area: AreaPick | null = existing ? { areaId: existing.areaId, op: existing.op, name: existing.name, lat: existing.lat, lon: existing.lon, modes: [] } : (o.area ?? null);
  let filter: LineFilter[] | undefined = existing?.filter;
  let propose: Propose = existing?.propose ?? 'never';
  const live = liveRegion();
  const linesBox = h('div');
  const save = h('button', { type: 'button', class: 'btn btn-primary btn-big btn-block' }, T.save);
  const sync = (): void => {
    save.disabled = !area;
  };

  async function loadLines(): Promise<void> {
    linesBox.replaceChildren();
    if (!area) return;
    const a = area;
    linesBox.appendChild(h('p', { class: 'small muted' }, 'Chargement des lignes…'));
    try {
      const core = await ctx.core();
      const lines = await core.linesAt(a.areaId);
      if (a !== area) return;
      if (!a.modes.length && lines.length) {
        a.modes = [...new Set(lines.map((l) => l.mode))];
        // Le champ montre le mode (« Gare du Nord, tram (STIB) »), sauf si une saisie est en cours.
        const input = picker?.querySelector<HTMLInputElement>('input');
        if (input && (input.value === areaText({ ...a, modes: [] }, s.lang) || input.value === displayName(a.name, s.lang))) input.value = areaText(a, s.lang);
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
        fs.appendChild(h('label', { class: 'choice compact' }, cb, `${MODE_TITLE[l.mode]} ${l.line} vers ${headText(l.head, s.lang, a.op)}`));
      }
      linesBox.replaceChildren(lines.length ? fs : h('p', { class: 'small muted' }, 'Aucune ligne trouvée pour cet arrêt.'));
    } catch (e) {
      // Zone disparue (M8) : « Arrêt introuvable : choisis-le à nouveau ».
      const text = e instanceof Error && !/introuvable/i.test(e.message) ? e.message : T.stopMissing;
      linesBox.replaceChildren(h('p', { class: 'small', role: 'alert' }, typo(text)));
    }
  }

  const picker = existing
    ? stopPicker(ctx, {
        id: 'fav-arret',
        label: 'Arrêt ou gare',
        value: area ? areaText(area, s.lang) : '',
        onPick: (a) => {
          area = a;
          filter = undefined;
          void loadLines();
          sync();
        },
      })
    : null;

  save.addEventListener('click', async () => {
    if (!area) return;
    const st: FavoriteStop = { kind: 'stop', id: existing?.id ?? newId('fav', ctx.settings.get().favorites.map((f) => f.id)), areaId: area.areaId, op: area.op, name: area.name, lat: area.lat, lon: area.lon, propose };
    if (filter?.length) st.filter = filter;
    if (!withFavorite(ctx.settings.get().favorites, st)) {
      live.say(typo(limitText(LIMITS.favorites)), true);
      return;
    }
    await ctx.settings.update((x) => ({ ...x, favorites: withFavorite(x.favorites, st) ?? x.favorites }));
    ctx.go('#/favoris');
  });

  void loadLines();
  sync();
  return h(
    'div',
    { class: 'stop-form' },
    picker,
    linesBox,
    radios<Propose>({ legend: T.proposeLegend, options: PROPOSE_OPTIONS, value: propose, onChange: (v) => (propose = v) }),
    save,
    live.el,
    existing ? deleteFavorite(ctx, existing.id) : null,
  );
}

/* ------------------------------ Trajet fixe ------------------------------ */

/**
 * Formulaire d'un trajet fixe (1.1) : « Départ » (lieux, adresses, gares et arrêts, jamais « Ma position » : ce cas
 * est un lieu), « Arrivée », « Nom affiché (« Vers le bureau »), facultatif », créneau, « Enregistrer ».
 */
function tripForm(ctx: PhoneCtx, existing?: FavoriteTrip): HTMLElement {
  const st = ctx.settings.get();
  let from: Endpoint | null = existing && existing.from.type !== 'here' ? existing.from : null;
  let to: Endpoint | null = existing?.to ?? null;
  let label = existing?.label ?? '';
  let propose: Propose = existing?.propose ?? 'never';
  const live = liveRegion();
  const save = h('button', { type: 'button', class: 'btn btn-primary btn-big btn-block' }, T.save);
  const sync = (): void => {
    save.disabled = !from || !to;
  };
  // Champs unifiés : le choix s'écrit dans le champ (« Bureau », « Gand-Saint-Pierre », CA-M4.12).
  const dep = placeField(ctx, { id: 'fav-de', label: 'Départ', placeholder: T.favField, value: from ? endpointText(from, st) : '', places: true, recent: true, onPick: (c) => { from = endpointOf(c); sync(); }, onEdit: () => { from = null; sync(); }, onFocus: () => arr.close() });
  const arr = placeField(ctx, { id: 'fav-vers', label: 'Arrivée', placeholder: T.favField, value: to ? endpointText(to, st) : '', here: true, places: true, recent: true, onPick: (c) => { to = endpointOf(c); sync(); }, onEdit: () => { to = null; sync(); }, onFocus: () => dep.close() });
  if (!existing) dep.input.setAttribute('data-autofocus', '');
  const lab = h('input', { id: 'fav-nom', class: 'input', type: 'text', value: label, maxlength: LIMITS.label, placeholder: 'bureau, maison…', autocomplete: 'off' });
  lab.addEventListener('input', () => (label = lab.value));

  save.addEventListener('click', async () => {
    if (!from || !to) return;
    const s = ctx.settings.get();
    const a = from;
    const b = to;
    if (!existing && s.favorites.some((f) => f.kind === 'trip' && sameEndpoint(f.from, a) && sameEndpoint(f.to, b))) {
      live.say(T.favExists);
      return;
    }
    const tr: FavoriteTrip = { kind: 'trip', id: existing?.id ?? newId('fav', s.favorites.map((f) => f.id)), from: a, to: b, propose };
    if (label.trim()) tr.label = label.trim().slice(0, LIMITS.label);
    if (!withFavorite(s.favorites, tr)) {
      live.say(typo(limitText(LIMITS.favorites)), true);
      return;
    }
    await ctx.settings.update((x) => ({ ...x, favorites: withFavorite(x.favorites, tr) ?? x.favorites }));
    ctx.go('#/favoris');
  });
  sync();
  return h(
    'div',
    { class: 'trip-form' },
    dep.el,
    arr.el,
    privacyNote(),
    h('div', { class: 'field' }, h('label', { for: 'fav-nom' }, typo('Nom affiché (« Vers le bureau »), facultatif')), lab),
    radios<Propose>({ legend: T.proposeLegend, options: PROPOSE_OPTIONS, value: propose, onChange: (v) => (propose = v) }),
    save,
    live.el,
    existing ? deleteFavorite(ctx, existing.id) : null,
  );
}

/** Écran « Trajet fixe » (lien « Un trajet fixe, d’un endroit à un autre »). */
export function fixedTripScreen(ctx: PhoneCtx): HTMLElement {
  return h('div', { class: 'screen' }, header(ctx, T.fixedTrip, undefined, { label: T.newFav, hash: '#/favoris/nouveau' }), tripForm(ctx));
}

/* ------------------------------ Nouveau favori ------------------------------ */

/** Écran « Nouveau favori » (PRD-1.2 § 2.2). */
export function newFavoriteScreen(ctx: PhoneCtx): HTMLElement {
  // Ancien lien de la 1.1 (#/favoris/nouveau?type=trajet) : le trajet fixe.
  if (ctx.params.get('type') === 'trajet') return fixedTripScreen(ctx);
  const live = liveRegion();
  const form = h('div', { class: 'form-body' });
  let current: FieldChoice | null = null;

  const field = placeField(ctx, {
    id: 'nf-lieu',
    label: T.favField,
    here: { label: T.hereOption, type: T.hereSub },
    recent: true,
    onEdit: () => {
      current = null;
      live.say('');
      form.replaceChildren();
    },
    onPick: (c) => void picked(c),
  });
  field.input.setAttribute('data-autofocus', '');

  /** Lieu : nom (adresse courte ou arrêt proposés), endroit et accès, créneau. */
  const showPlace = (spot: Spot, name: string): void => {
    form.replaceChildren(placeForm(ctx, { spot, name }));
    form.querySelector<HTMLInputElement>('#pl-nom')?.focus({ preventScroll: true });
  };

  async function picked(c: FieldChoice): Promise<void> {
    current = c;
    form.replaceChildren();
    if (c.kind === 'here') {
      live.say(T.hereSearching);
      const spot = await hereSpot(ctx);
      if (current !== c) return;
      if (!spot) return live.say(typo(ctx.web ? T.hereDownWeb : T.hereDown), true);
      live.say('');
      return showPlace(spot, '');
    }
    live.say('');
    if (c.kind === 'address' || c.kind === 'place') {
      const spot = spotOf(c);
      if (spot) showPlace(spot, c.kind === 'address' ? shortAddress(c.label) : c.label);
      return;
    }
    // Gare ou arrêt : « Ses prochains départs » (par défaut) ou « Le trajet pour y aller ».
    const area = areaOfItem(c.item);
    const below = h('div');
    const show = (mode: 'board' | 'place'): void => {
      below.replaceChildren(mode === 'board' ? stopForm(ctx, { area }) : placeForm(ctx, { spot: spotOf(c)!, name: c.label }));
    };
    const choice = radios<'board' | 'place'>({
      legend: T.inGlasses,
      value: 'board',
      options: [
        { value: 'board', label: T.nextDepartures },
        { value: 'place', label: T.tripThere },
      ],
      onChange: show,
    });
    show('board');
    form.replaceChildren(choice, below);
    choice.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true });
  }

  return h(
    'div',
    { class: 'screen' },
    header(ctx, T.newFav, undefined, BACK),
    field.el,
    privacyNote(),
    h('button', { type: 'button', class: 'btn-link', onclick: () => ctx.go('#/favoris/trajet') }, T.fixedTripLink),
    live.el,
    form,
  );
}

/* ------------------------------ Modification ------------------------------ */

/** Suppression d'un arrêt ou d'un trajet fixe, confirmée dans la page (« Supprimer ce favori ? »). */
function deleteFavorite(ctx: PhoneCtx, id: string): HTMLElement {
  return confirmInPage({
    trigger: T.removeFavButton,
    question: typo(T.removeFav),
    confirm: T.remove,
    cancel: T.cancel,
    onConfirm: async () => {
      await ctx.settings.update((x) => ({ ...x, favorites: x.favorites.filter((f) => f.id !== id) }));
      ctx.go('#/favoris');
    },
  });
}

/** Modification d'un favori selon sa sorte ; favori inconnu (supprimé, ancien lien) : la liste. */
export function favoriteEditScreen(ctx: PhoneCtx, id: string): HTMLElement {
  const f = ctx.settings.get().favorites.find((x) => x.id === id);
  if (!f) return favoritesScreen(ctx);
  if (f.kind === 'place') return h('div', { class: 'screen' }, header(ctx, f.label, undefined, BACK), placeForm(ctx, { existing: f }));
  return h('div', { class: 'screen' }, header(ctx, 'Modifier le favori', undefined, BACK), f.kind === 'stop' ? stopForm(ctx, { existing: f }) : tripForm(ctx, f));
}
