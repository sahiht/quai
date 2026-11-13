/**
 * Ajout et modification d'un favori (PRD-1.2 § 2.2, PRD-1.2.1 § 7.1, PRD-1.2.2 § 4).
 *  - « Nouveau favori » : en haut, deux choix de même taille, « Un endroit » (choisi d'office) et « Un trajet de A à
 *    B ». « Un endroit » : un seul champ « Adresse, gare ou arrêt », avec en tête « Ma position actuelle » ; une
 *    adresse, la position, une gare ou un arrêt donnent toujours un lieu (« Le trajet pour y aller »). 1.2.2 (revue
 *    d'usage n° 3) : plus d'arrêt favori ; pour une gare, un lien au-dessus du formulaire l'ajoute à « Gares » ; pour
 *    un arrêt de bus, tram ou métro, il mène à « Ajouter une ligne », arrêt présélectionné.
 *  - Trajet fixe : « Départ » (jamais « Ma position »), « Arrivée », nom affiché, créneau (1.1). Lieu : voir places.ts.
 *  - Modification : pas de choix, le formulaire du favori ; suppression confirmée dans la page.
 */
import type { Endpoint, Favorite, FavoriteTrip, Propose, SearchItem } from '../../core/api';
import { displayName } from '../../core/util';
import { LIMITS, newId } from '../../settings';
import { header, type PhoneCtx } from '../app';
import { h, liveRegion } from '../dom';
import { placeField, privacyNote, type FieldChoice } from '../field';
import { endpointText, limitText, nextDeparturesLink, PROPOSE_LABEL, PROPOSE_ORDER, sameEndpoint, shortAddress, stationAddedText, stationLimitText, T, typo } from '../text';
import { confirmInPage, messageHub, radios, segmentedTabs } from '../ui';
import { favoritesScreen } from './favorites';
import { withStation } from './picks';
import { hereSpot, placeForm, spotOf, type Spot } from './places';

const BACK = { label: T.myFavs, hash: '#/favoris' };

/** « En tête de l’accueil » d'un trajet fixe (revue d'usage n° 11) : Automatique, le matin, le soir, d'office à moins de 300 m. */
export const PROPOSE_OPTIONS: { value: Propose; label: string }[] = PROPOSE_ORDER.map((value) => ({ value, label: typo(PROPOSE_LABEL[value]) }));

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

/* ------------------------------ Gare ou arrêt : la bonne rubrique ------------------------------ */

/**
 * Lien au-dessus du formulaire d'un lieu placé à une gare ou à un arrêt (revue d'usage n° 3) : une gare SNCB
 * s'ajoute à « Gares » d'un toucher (« Namur ajoutée à Gares. ») ; un arrêt de bus, tram ou métro mène à « Ajouter
 * un arrêt », lui en tête (1.2.6).
 */
export function departuresLink(ctx: PhoneCtx, it: SearchItem): HTMLElement {
  if (it.op !== 'sncb') return h('a', { class: 'jump', href: `#/arrets/ajouter?arret=${encodeURIComponent(it.id)}` }, typo(T.nextPassagesLink));
  const name = displayName(it.n, ctx.settings.get().lang);
  const hub = messageHub();
  const msg = hub.slot();
  const station = { areaId: it.id, name: it.n, lat: it.lat, lon: it.lon };
  const link = h('button', { type: 'button', class: 'jump' }, typo(nextDeparturesLink(name)));
  link.addEventListener('click', async () => {
    const r = withStation(ctx.settings.get(), station, ctx.clock.now());
    if (r === 'exists') return hub.say(msg, T.stationExists);
    if (r === 'full') return hub.say(msg, typo(stationLimitText(LIMITS.stations)), true);
    await ctx.settings.update((x) => {
      const again = withStation(x, station, ctx.clock.now());
      return typeof again === 'object' ? again.settings : x;
    });
    hub.say(msg, stationAddedText(name));
  });
  return h('div', { class: 'jump-box' }, link, msg);
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

/* ------------------------------ Nouveau favori ------------------------------ */

/** Les deux choix de « Nouveau favori » (PRD-1.2.1 § 7.1) : un endroit (un lieu), ou un trajet fixe. */
export type NewFavoriteKind = 'place' | 'trip';

/**
 * « Un endroit » (PRD-1.2 § 2.2) : champ unique « Adresse, gare ou arrêt » avec en tête « Ma position actuelle », puis
 * le formulaire du lieu choisi. Une gare ou un arrêt donne toujours un lieu « Près de … » (« Le trajet pour y aller »),
 * avec au-dessus le lien vers « Gares » ou « Bus, tram, métro » (revue d'usage n° 3).
 */
function placeChoice(ctx: PhoneCtx): HTMLElement {
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
    // Gare ou arrêt : un lieu « Près de … » ; ses départs se gardent dans la bonne rubrique, par le lien au-dessus.
    const spot = spotOf(c);
    if (!spot) return;
    form.replaceChildren(departuresLink(ctx, c.item), placeForm(ctx, { spot, name: c.label }));
    form.querySelector<HTMLInputElement>('#pl-nom')?.focus({ preventScroll: true });
  }

  return h('div', { class: 'place-choice' }, field.el, privacyNote(), live.el, form);
}

/**
 * Écran « Nouveau favori » (PRD-1.2.1 § 7.1) : en haut, « Un endroit » (sous-titre « adresse, gare ou arrêt »,
 * choisi d'office) et « Un trajet de A à B » (« départ et arrivée fixes »), de même taille ; chacun montre son
 * formulaire. `initial` : le choix montré à l'ouverture.
 */
export function newFavoriteScreen(ctx: PhoneCtx, initial?: NewFavoriteKind): HTMLElement {
  // Ancien lien de la 1.1 (#/favoris/nouveau?type=trajet) : le trajet de A à B.
  const first: NewFavoriteKind = initial ?? (ctx.params.get('type') === 'trajet' ? 'trip' : 'place');
  const kinds = segmentedTabs<NewFavoriteKind>({
    label: T.kindLegend,
    value: first,
    options: [
      { value: 'place', label: T.kindPlace, sub: T.kindPlaceSub, panel: placeChoice(ctx) },
      { value: 'trip', label: T.kindTrip, sub: T.kindTripSub, panel: tripForm(ctx) },
    ],
  });
  // Curseur à l'ouverture : le premier champ du choix montré (le routeur prend le premier champ data-autofocus).
  for (const p of kinds.panels) if (p.hidden) p.querySelectorAll('[data-autofocus]').forEach((e) => e.removeAttribute('data-autofocus'));
  return h('div', { class: 'screen' }, header(ctx, T.newFav, undefined, BACK), kinds.el, ...kinds.panels);
}

/** Ancre « #/favoris/trajet » (lien du trajet fixe de la 1.2, retiré) : « Nouveau favori », choix « Un trajet de A à B ». */
export function fixedTripScreen(ctx: PhoneCtx): HTMLElement {
  return newFavoriteScreen(ctx, 'trip');
}

/* ------------------------------ Modification ------------------------------ */

/** Suppression d'un trajet fixe, confirmée dans la page (« Supprimer ce favori ? »). */
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

/**
 * Modification d'un favori selon sa sorte ; favori inconnu (supprimé, ancien lien) : la liste. 1.2.2 : un arrêt favori
 * n'existe plus dans les réglages v4 (rangé dans « Gares » ou « Bus, tram, métro ») : la liste aussi.
 */
export function favoriteEditScreen(ctx: PhoneCtx, id: string): HTMLElement {
  const f = ctx.settings.get().favorites.find((x) => x.id === id);
  if (!f || f.kind === 'stop') return favoritesScreen(ctx);
  if (f.kind === 'place') return h('div', { class: 'screen' }, header(ctx, f.label, undefined, BACK), placeForm(ctx, { existing: f }));
  return h('div', { class: 'screen' }, header(ctx, 'Modifier le favori', undefined, BACK), tripForm(ctx, f));
}
