/**
 * Lieux (PRD-1.2 § 2) : un lieu est un favori (adresse, arrêt ou position prise sur place, avec un nom) qui donne
 * « Vers {lieu} » depuis la position. Ici : texte d'accès d'un lieu (§ 2.5), et formulaire d'un lieu (nom et
 * raccourcis, endroit et accès, créneau, « Enregistrer »), pour un nouveau lieu comme pour une modification.
 * Jamais de coordonnées à l'écran. Lieux de la 1.0 à adresse libre : « Adresse à vérifier » et « Vérifier l’adresse ».
 */
import type { AreaSummary, Favorite, FavoritePlace, Mode, NameLang, NearbyItem, Place, Propose } from '../../core/api';
import { displayName, mainMode, modeWord } from '../../core/util';
import { LIMITS, newId } from '../../settings';
import { normalizeForSearch } from '../../../../shared/names';
import type { PhoneCtx } from '../app';
import { append, h, icon, liveRegion } from '../dom';
import { placeField, type FieldChoice } from '../field';
import { defaultSlot, legacyQuery, limitText, needsCheck, PLACE_PROPOSE, placeSubtitle, PROPOSE_LABEL, removeUsedPlaceText, T, typo } from '../text';
import { confirmInPage, nameShortcuts, radios } from '../ui';

const MODE_ORDER: Mode[] = ['train', 'metro', 'tram', 'bus'];

/** « Gare de Namur », « gare d’Ottignies » (élision devant une voyelle). */
const stationName = (name: string, capital: boolean): string => `${capital ? 'Gare' : 'gare'} ${/^[aeiouyàâäéèêëîïôöûüœ]/i.test(name) ? `d’${name}` : `de ${name}`}`;

/** « Métro Madou », « Bus TEC Namur Omalius », « Tram De Lijn Korenmarkt », « Gare de Namur » (mots de l'appli). */
function stopName(a: AreaSummary, lang: NameLang, capital: boolean): string {
  const name = displayName(a.n, lang);
  const mode = mainMode(a.modes);
  if (mode === 'train') return stationName(name, capital);
  const word = modeWord(mode, a.op);
  return `${capital ? word.charAt(0).toUpperCase() + word.slice(1) : word} ${name}`;
}

/**
 * Accès d'un lieu (PRD-1.2 § 2.5) : l'arrêt le plus proche d'abord, nommé (« Métro Madou à 2 min à pied »,
 * « Gare de Namur à 7 min à pied ») ; le plus proche : le moins de minutes, puis train, métro, tram, bus, puis la
 * distance. Ensuite la gare, seulement si elle est utile : desservie par des IC, à la marche maximale ou moins et
 * pas déjà citée (« ; gare de Namur à 8 min »). Rien à 800 m : « Aucun arrêt à moins de 800 m ».
 */
export function accessText(list: NearbyItem[], lang: NameLang, maxWalkMin = 10): string {
  if (!list.length) return 'Aucun arrêt à moins de 800 m';
  const rank = (n: NearbyItem): number => MODE_ORDER.indexOf(mainMode(n.area.modes));
  const nearest = [...list].sort((a, b) => a.walkMin - b.walkMin || rank(a) - rank(b) || a.distanceM - b.distanceM)[0];
  const text = `${stopName(nearest.area, lang, true)} à ${nearest.walkMin} min à pied`;
  const station = list
    .filter((n) => n !== nearest && n.area.id !== nearest.area.id && mainMode(n.area.modes) === 'train' && n.area.lines.includes('IC') && n.walkMin <= maxWalkMin)
    .sort((a, b) => a.walkMin - b.walkMin || a.distanceM - b.distanceM)[0];
  return station ? `${text} ; ${stopName(station.area, lang, false)} à ${station.walkMin} min` : text;
}

/** Icône d'un lieu selon son nom : maison, bureau, sinon repère. */
export const placeIcon = (label: string): HTMLSpanElement => (/maison|domicile|chez/i.test(label) ? icon('home') : /bureau|travail|boulot/i.test(label) ? icon('work') : icon('pin'));

/** Accès d'un lieu, écrit dans `el` quand les arrêts proches sont connus. */
export function fillAccess(ctx: Pick<PhoneCtx, 'core' | 'settings'>, el: Element, at: { lat: number; lon: number }): void {
  void ctx
    .core()
    .then((core) => core.nearby(at.lat, at.lon, 800, { light: true }))
    .then((items) => {
      const st = ctx.settings.get();
      el.textContent = typo(accessText(items, st.lang, st.maxWalkMin));
    })
    .catch(() => {
      el.textContent = '';
    });
}

/** Endroit d'un lieu (adresse, arrêt ou position prise sur place). */
export type Spot = Pick<Place, 'lat' | 'lon' | 'src' | 'address' | 'approx' | 'areaId'>;

/** Endroit tiré d'un choix du champ unique (adresse normalisée, arrêt « Près de Namur », lieu existant). */
export function spotOf(c: FieldChoice): Spot | null {
  if (c.kind === 'address') return c.approx ? { lat: c.lat, lon: c.lon, src: 'address', address: c.label, approx: true } : { lat: c.lat, lon: c.lon, src: 'address', address: c.label };
  if (c.kind === 'stop') return { lat: c.item.lat, lon: c.item.lon, src: 'stop', address: `Près de ${c.label}`.slice(0, LIMITS.address), areaId: c.item.id };
  if (c.kind === 'place') return { lat: c.place.lat, lon: c.place.lon, src: c.place.src, address: c.place.address, approx: c.place.approx, areaId: c.place.areaId };
  return null;
}

/** « Ma position actuelle » : la position du moment, arrondie (environ 1 m), ou null si elle manque. */
export async function hereSpot(ctx: Pick<PhoneCtx, 'location'>): Promise<Spot | null> {
  const fix = await ctx.location.current(10_000);
  return fix ? { lat: Math.round(fix.lat * 1e5) / 1e5, lon: Math.round(fix.lon * 1e5) / 1e5, src: 'here' } : null;
}

/** Favori lieu complet à partir de son nom, de son endroit et de son créneau. */
export function makePlace(id: string, label: string, spot: Spot, propose: Propose): FavoritePlace {
  const place: FavoritePlace = { kind: 'place', id, label: label.slice(0, LIMITS.label), lat: spot.lat, lon: spot.lon, propose };
  if (spot.address) place.address = spot.address;
  if (spot.src) place.src = spot.src;
  if (spot.approx) place.approx = true;
  if (spot.areaId) place.areaId = spot.areaId;
  return place;
}

/**
 * Ajoute ou remplace un lieu dans les favoris. `place.id` vide : nouveau lieu ; un lieu de même nom est alors remplacé
 * à sa place (même identifiant : les trajets fixes qui le citent suivent), sinon le lieu s'ajoute en fin de liste.
 * Rend null si la limite des 32 favoris est atteinte.
 */
export function withPlace(favorites: Favorite[], place: FavoritePlace): { favorites: Favorite[]; place: FavoritePlace } | null {
  const same = place.id ? favorites.find((f) => f.id === place.id) : favorites.find((f) => f.kind === 'place' && normalizeForSearch(f.label) === normalizeForSearch(place.label));
  if (!same && favorites.length >= LIMITS.favorites) return null;
  const done: FavoritePlace = { ...place, id: same?.id ?? (place.id || newId('lieu', favorites.map((f) => f.id))) };
  return { place: done, favorites: same ? favorites.map((f) => (f.id === same.id ? done : f)) : [...favorites, done] };
}

/** Créneaux d'un lieu : « Jamais », « Le matin (5 h à 11 h) », « Le soir (15 h à 21 h) ». */
const PLACE_OPTIONS = PLACE_PROPOSE.map((value) => ({ value, label: typo(PROPOSE_LABEL[value]) }));

export interface PlaceFormOptions {
  /** Modification d'un lieu : champ de l'endroit, vérification des lieux 1.0, suppression. */
  existing?: FavoritePlace;
  /** Nouveau lieu : endroit déjà choisi dans le champ « Adresse, gare ou arrêt ». */
  spot?: Spot;
  /** Nom proposé d'un nouveau lieu (adresse courte, nom de l'arrêt). */
  name?: string;
}

/**
 * Formulaire d'un lieu (PRD-1.2 § 2.2) : « Nom » et ses raccourcis, l'endroit et son accès, « Le proposer à
 * l’ouverture », « Enregistrer ». Un nouveau lieu nommé « Bureau » est proposé le matin, « Maison » le soir, tant
 * que le créneau n'a pas été touché.
 */
export function placeForm(ctx: PhoneCtx, o: PlaceFormOptions): HTMLElement {
  const existing = o.existing;
  let spot: Spot | null = existing ? { lat: existing.lat, lon: existing.lon, src: existing.src, address: existing.address, approx: existing.approx, areaId: existing.areaId } : (o.spot ?? null);
  let propose: Propose = existing ? (PLACE_PROPOSE.includes(existing.propose) ? existing.propose : 'never') : defaultSlot(o.name ?? '');
  let proposeTouched = !!existing;
  const live = liveRegion();
  const name = h('input', { id: 'pl-nom', class: 'input', type: 'text', value: (existing?.label ?? o.name ?? '').slice(0, LIMITS.label), maxlength: LIMITS.label, autocomplete: 'off', placeholder: 'Maison, Bureau…' });
  const save = h('button', { type: 'button', class: 'btn btn-primary btn-big btn-block', 'aria-describedby': 'pl-hint' }, T.save);
  const hint = h('p', { class: 'small muted', id: 'pl-hint' });
  const where = h('div', { class: 'spot', 'aria-live': 'polite' });
  const slots = radios<Propose>({
    legend: T.proposeLegend,
    options: PLACE_OPTIONS,
    value: propose,
    onChange: (v) => {
      propose = v;
      proposeTouched = true;
    },
  });

  const sync = (): void => {
    save.disabled = !name.value.trim() || !spot;
    hint.textContent = !name.value.trim() ? T.needName : !spot ? T.needSpot : '';
  };
  /** Confirmation de l'endroit : adresse normalisée (ou « Près de … »), rue sans numéro, puis l'accès. */
  const confirmSpot = (): void => {
    where.replaceChildren();
    if (!spot) return;
    const access = h('span', { class: 't3' }, '…');
    // Lieu 1.0 pas encore vérifié : « Adresse à vérifier » est dit au-dessus, seul l'accès est rappelé ici.
    const what = spot.src ? h('span', { class: 't1' }, typo(placeSubtitle({ id: '', label: '', ...spot }))) : null;
    append(where, [what, spot.approx ? h('span', { class: 't2' }, typo(T.approx)) : null, access]);
    fillAccess(ctx, access, spot);
  };

  name.addEventListener('input', () => {
    // « Bureau » : le matin ; « Maison » : le soir (créneau proposé tant qu'il n'a pas été choisi).
    if (!proposeTouched) {
      propose = defaultSlot(name.value);
      const radio = slots.querySelector<HTMLInputElement>(`input[value="${propose}"]`);
      if (radio) radio.checked = true;
    }
    sync();
  });

  // Modification : l'endroit se change dans le champ unique (avec « Ma position actuelle »).
  const legacy = !!existing && needsCheck(existing);
  let field: ReturnType<typeof placeField> | null = null;
  // Choix en cours : une position arrivée après un autre choix (ou une saisie) ne le remplace pas.
  let pickSeq = 0;
  if (existing) {
    field = placeField(ctx, {
      id: 'pl-lieu',
      label: T.favField,
      value: legacy ? undefined : existing.src === 'stop' ? legacyQuery(existing) : existing.src === 'address' ? existing.address : undefined,
      here: { label: T.hereOption, type: T.hereSub },
      recent: true,
      // Texte changé après un choix (« 25 » corrigé en « 52 ») : le choix ne vaut plus, il faut en refaire un.
      onEdit: () => {
        pickSeq++;
        live.say('');
        spot = null;
        confirmSpot();
        sync();
      },
      onPick: async (c) => {
        const my = ++pickSeq;
        if (c.kind === 'here') {
          spot = null;
          confirmSpot();
          sync();
          live.say(T.hereSearching);
          const s = await hereSpot(ctx);
          if (my !== pickSeq) return;
          if (!s) return live.say(typo(ctx.web ? T.hereDownWeb : T.hereDown), true);
          spot = s;
          live.say('');
        } else {
          spot = spotOf(c);
          live.say('');
        }
        confirmSpot();
        sync();
      },
    });
    // Lieu 1.0 : le texte libre est gardé tel quel, prêt à être vérifié (CA-M4.10).
    if (legacy) field.input.value = existing.address ?? '';
  }

  save.addEventListener('click', async () => {
    const label = name.value.trim();
    if (!label || !spot) return;
    const place = makePlace(existing?.id ?? '', label, spot, propose);
    if (!withPlace(ctx.settings.get().favorites, place)) {
      live.say(typo(limitText(LIMITS.favorites)), true);
      return;
    }
    await ctx.settings.update((x) => ({ ...x, favorites: withPlace(x.favorites, place)?.favorites ?? x.favorites }));
    ctx.go('#/favoris');
  });

  const verify = legacy
    ? h(
        'div',
        { class: 'box pad verify' },
        h('strong', null, T.toVerify),
        h('span', null, typo(`Texte enregistré avec la version précédente : « ${existing.address} ».`)),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => field?.search(legacyQuery(existing)) }, T.verify),
      )
    : null;
  const del = existing ? deletePlace(ctx, existing) : null;
  confirmSpot();
  sync();
  return h(
    'div',
    { class: 'place-form' },
    h('div', { class: 'field' }, h('label', { for: 'pl-nom' }, T.name), name, nameShortcuts(name)),
    verify,
    field?.el ?? null,
    where,
    live.el,
    slots,
    save,
    hint,
    del,
  );
}

/** Trajets fixes qui citent un lieu (départ ou arrivée). */
export function tripsUsing(favorites: Favorite[], placeId: string): string[] {
  return favorites.filter((f) => f.kind === 'trip' && [f.from, f.to].some((e) => e.type === 'place' && e.placeId === placeId)).map((f) => f.id);
}

/** Suppression d'un lieu, confirmée dans la page ; les trajets fixes qui l'utilisent partent avec lui (PRD-1.2 § 2.2). */
function deletePlace(ctx: PhoneCtx, place: FavoritePlace): HTMLElement {
  const used = tripsUsing(ctx.settings.get().favorites, place.id).length > 0;
  return confirmInPage({
    trigger: T.removeFavButton,
    question: typo(used ? removeUsedPlaceText(place.label) : T.removeFav),
    confirm: T.remove,
    cancel: T.cancel,
    onConfirm: async () => {
      await ctx.settings.update((x) => {
        const gone = new Set([place.id, ...tripsUsing(x.favorites, place.id)]);
        return { ...x, favorites: x.favorites.filter((f) => !gone.has(f.id)) };
      });
      ctx.go('#/favoris');
    },
  });
}
