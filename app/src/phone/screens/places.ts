/**
 * Réglage 2 sur 6 : mes lieux (T3, maquette Config2). Un lieu se place par le champ unique (adresse normalisée, ou
 * arrêt : « Près de Namur »), ou par « Utiliser ma position actuelle » ; jamais de coordonnées à l'écran.
 * Lieux de la 1.0 à adresse libre : « Adresse à vérifier » et « Vérifier l’adresse » (M4.8).
 * Après un nouveau lieu : « Ajouter le trajet vers {nom} à tes favoris ? » (S3). Adresses récentes (S4).
 */
import type { AreaSummary, FavoriteTrip, Mode, NameLang, NearbyItem, Place, Propose } from '../../core/api';
import { displayName, mainMode, modeWord } from '../../core/util';
import { LIMITS, newId } from '../../settings';
import { header, type PhoneCtx } from '../app';
import { append, h, icon, ICON, liveRegion } from '../dom';
import { placeField, privacyNote } from '../field';
import { addTripQuestion, defaultSlot, legacyQuery, needsCheck, placeSubtitle, PROPOSE_LABEL, removePlaceText, T, typo } from '../text';
import { confirmInPage, listRow, messageHub, nameShortcuts, radios, stepper } from '../ui';

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
 * Accès d'un lieu (moins-de-marche.md § 6) : l'arrêt le plus proche d'abord, nommé (« Métro Madou à 2 min à pied »,
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

const placeIcon = (label: string) => (/maison|domicile|chez/i.test(label) ? icon('home') : /bureau|travail|boulot/i.test(label) ? icon('work') : icon('pin'));

/** Accès d'un lieu, écrit dans `el` quand les arrêts proches sont connus. */
function fillAccess(ctx: PhoneCtx, el: Element, at: { lat: number; lon: number }): void {
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

/** Question après un nouveau lieu (S3) : le trajet depuis « Ma position », créneau proposé d'office. */
function tripOffer(ctx: PhoneCtx, place: Place): HTMLElement {
  const hub = messageHub();
  const msg = hub.slot();
  let propose: Propose = defaultSlot(place.label);
  const add = h('button', { type: 'button', class: 'btn btn-primary' }, T.addFav);
  const no = h('button', { type: 'button', class: 'btn btn-secondary' }, T.noThanks);
  const qid = 'offre-trajet';
  const actions = h('div', { class: 'confirm-actions' }, add, no);
  const slots = radios<Propose>({
    legend: 'Le proposer à l’ouverture',
    value: propose,
    options: (['never', 'near', 'morning', 'evening'] as const).map((v) => ({ value: v, label: typo(PROPOSE_LABEL[v]) })),
    onChange: (v) => (propose = v),
  });
  const box = h('section', { class: 'offer box pad', 'aria-labelledby': qid }, h('p', { id: qid, class: 'confirm-q' }, typo(addTripQuestion(place.label))), slots, actions, msg);
  const forget = (): void => {
    // La question ne revient pas au prochain affichage de « Mes lieux ».
    if (/[?&]nouveau=/.test(location.hash)) history.replaceState(null, '', '#/lieux');
  };
  add.addEventListener('click', async () => {
    const s = ctx.settings.get();
    const exists = s.favorites.some((f) => f.kind === 'trip' && f.from.type === 'here' && f.to.type === 'place' && f.to.placeId === place.id);
    if (!exists && s.favorites.length >= LIMITS.favorites) return hub.say(msg, typo(`${LIMITS.favorites} favoris au plus : supprimes-en un dans Mes favoris.`), true);
    if (!exists) {
      const fav: FavoriteTrip = { kind: 'trip', id: newId('fav', s.favorites.map((f) => f.id)), from: { type: 'here' }, to: { type: 'place', placeId: place.id }, propose };
      await ctx.settings.update((x) => ({ ...x, favorites: [...x.favorites, fav] }));
    }
    slots.remove();
    actions.remove();
    hub.say(msg, exists ? T.favExists : T.favAdded);
    forget();
  });
  no.addEventListener('click', () => {
    forget();
    box.remove();
  });
  return box;
}

export function placesScreen(ctx: PhoneCtx): HTMLElement {
  const s = ctx.settings.get();
  const list = h('ul', { class: 'list box' });
  for (const p of s.places) {
    const row = listRow({ icon: placeIcon(p.label), title: p.label, sub: typo(placeSubtitle(p)), sub2: ' ', label: `Modifier ${p.label}`, onClick: () => ctx.go(`#/lieux/${encodeURIComponent(p.id)}`) });
    list.appendChild(row);
    const t3 = row.querySelector('.t3');
    if (t3) fillAccess(ctx, t3, p);
  }
  if (!s.places.length) list.appendChild(h('li', { class: 'small', style: 'padding:14px 16px' }, 'Aucun lieu pour l’instant. Ajoute Maison ou Bureau.'));
  const fresh = s.places.find((p) => p.id === ctx.params.get('nouveau'));
  const offered = fresh && !s.favorites.some((f) => f.kind === 'trip' && f.to.type === 'place' && f.to.placeId === fresh.id);
  const recent = s.recent.length
    ? h(
        'section',
        { class: 'box pad', 'aria-labelledby': 'recents' },
        h('h2', { id: 'recents' }, 'Adresses récentes'),
        h('ul', { class: 'plain' }, s.recent.map((r) => h('li', { class: 'small' }, r.label))),
        h('button', {
          type: 'button',
          class: 'btn btn-secondary btn-block',
          onclick: async () => {
            await ctx.settings.update((x) => ({ ...x, recent: [] }));
            ctx.go('#/lieux');
          },
        }, T.clearRecent),
      )
    : null;
  return h(
    'div',
    { class: 'screen' },
    header(ctx, 'Mes lieux', 'Les arrêts proches sont trouvés automatiquement.', { label: 'Accueil', hash: '#/' }),
    offered ? tripOffer(ctx, fresh) : null,
    list,
    h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => ctx.go('#/lieux/nouveau'), disabled: s.places.length >= LIMITS.places, html: `${ICON.plus}<span>Ajouter un lieu</span>` }),
    h(
      'div',
      { class: 'box' },
      stepper({
        label: 'Marche maximale',
        sub: 'vers un arrêt ou une gare',
        value: s.maxWalkMin,
        min: LIMITS.maxWalkMin[0],
        max: LIMITS.maxWalkMin[1],
        format: (v) => typo(`${v} min`),
        less: 'Réduire la marche maximale',
        more: 'Augmenter la marche maximale',
        onChange: (v) => void ctx.settings.update((x) => ({ ...x, maxWalkMin: v })),
      }),
    ),
    recent,
    h('p', { class: 'note', html: `${ICON.clock}<span>${typo('Chaque nuit, Quai prépare les horaires du jour ; les trajets entre tes lieux sont calculés sur le téléphone, correspondances comprises.')}</span>` }),
  );
}

/** Position choisie pour un lieu (adresse, arrêt ou position actuelle). */
type Spot = Pick<Place, 'lat' | 'lon' | 'src' | 'address' | 'approx' | 'areaId'>;

export function placeEditScreen(ctx: PhoneCtx, id: string): HTMLElement {
  const s = ctx.settings.get();
  const existing = s.places.find((p) => p.id === id);
  const isNew = !existing;
  let spot: Spot | null = existing ? { lat: existing.lat, lon: existing.lon, src: existing.src, address: existing.address, approx: existing.approx, areaId: existing.areaId } : null;
  const live = liveRegion();
  const name = h('input', { id: 'pl-name', class: 'input', type: 'text', value: existing?.label ?? '', maxlength: LIMITS.label, autocomplete: 'off', placeholder: 'Maison, Bureau…' });
  const save = h('button', { type: 'button', class: 'btn btn-primary btn-big btn-block', 'aria-describedby': 'pl-hint' }, T.savePlace);
  const hint = h('p', { class: 'small muted', id: 'pl-hint' });
  const where = h('div', { class: 'spot', 'aria-live': 'polite' });

  const sync = (): void => {
    save.disabled = !name.value.trim() || !spot;
    hint.textContent = !name.value.trim() ? 'Donne un nom au lieu.' : !spot ? 'Choisis une adresse ou un arrêt dans la liste.' : '';
  };
  /** Confirmation du choix : adresse normalisée (ou « Près de … »), rue sans numéro, puis l'accès. */
  const confirmSpot = (): void => {
    where.replaceChildren();
    if (!spot) return;
    const access = h('span', { class: 't3' }, '…');
    // Lieu 1.0 pas encore vérifié : « Adresse à vérifier » est dit au-dessus, seul l'accès est rappelé ici.
    const what = spot.src ? h('span', { class: 't1' }, typo(placeSubtitle({ id: '', label: '', ...spot }))) : null;
    append(where, [what, spot.approx ? h('span', { class: 't2' }, typo(T.approx)) : null, access]);
    fillAccess(ctx, access, spot);
  };

  const legacy = existing && needsCheck(existing);
  const field = placeField(ctx, {
    id: 'pl-addr',
    label: 'Adresse',
    placeholder: T.addrPlaceholder,
    value: existing && !legacy ? (existing.src === 'stop' ? legacyQuery(existing) : existing.src === 'address' ? existing.address : undefined) : undefined,
    recent: true,
    // Texte changé après un choix (« 25 » corrigé en « 52 ») : le choix ne vaut plus, il faut en refaire un.
    onEdit: () => {
      spot = null;
      confirmSpot();
      sync();
    },
    onPick: (c) => {
      if (c.kind === 'address') spot = { lat: c.lat, lon: c.lon, src: 'address', address: c.label, approx: c.approx || undefined };
      else if (c.kind === 'stop') spot = { lat: c.item.lat, lon: c.item.lon, src: 'stop', address: `Près de ${c.label}`, areaId: c.item.id };
      else if (c.kind === 'place') spot = { lat: c.place.lat, lon: c.place.lon, src: c.place.src, address: c.place.address, approx: c.place.approx, areaId: c.place.areaId };
      if (!name.value.trim() && c.kind === 'stop') name.value = c.label.slice(0, LIMITS.label);
      live.say('');
      confirmSpot();
      sync();
    },
  });
  // Lieu 1.0 : le texte libre est gardé tel quel, prêt à être vérifié (CA-M4.10).
  if (legacy) field.input.value = existing.address ?? '';

  const here = h('button', { type: 'button', class: 'btn btn-secondary btn-block here-btn', html: `${ICON.pin}<span class="cc"><span>${T.useHere}</span><span class="sub">${T.hereSub}</span></span>` });
  here.addEventListener('click', async () => {
    live.say('Recherche de la position…');
    const fix = await ctx.location.current(10_000);
    if (!fix) {
      live.say(typo(ctx.web ? 'Position indisponible : autorise-la dans le navigateur, ou choisis une adresse ou un arrêt.' : 'Position indisponible : autorise la position pour Quai dans l’appli Even.'), true);
      return;
    }
    spot = { lat: Math.round(fix.lat * 1e5) / 1e5, lon: Math.round(fix.lon * 1e5) / 1e5, src: 'here' };
    field.show('');
    live.say('Position actuelle enregistrée pour ce lieu.');
    confirmSpot();
    sync();
  });

  name.addEventListener('input', sync);
  save.addEventListener('click', async () => {
    const label = name.value.trim();
    if (!label || !spot) return;
    const place: Place = { id: existing?.id ?? newId('lieu', ctx.settings.get().places.map((p) => p.id)), label, lat: spot.lat, lon: spot.lon };
    if (spot.address) place.address = spot.address;
    if (spot.src) place.src = spot.src;
    if (spot.approx) place.approx = true;
    if (spot.areaId) place.areaId = spot.areaId;
    await ctx.settings.update((x) => ({ ...x, places: isNew ? [...x.places, place] : x.places.map((p) => (p.id === place.id ? place : p)) }));
    ctx.go(isNew ? `#/lieux?nouveau=${encodeURIComponent(place.id)}` : '#/lieux');
  });

  const verify = legacy
    ? h(
        'div',
        { class: 'box pad verify' },
        h('strong', null, T.toVerify),
        h('span', null, typo(`Texte enregistré avec la version précédente : « ${existing.address} ».`)),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => field.search(legacyQuery(existing)) }, T.verify),
      )
    : null;
  const del = existing
    ? confirmInPage({
        trigger: 'Supprimer ce lieu',
        question: typo(removePlaceText(existing.label)),
        confirm: T.remove,
        cancel: T.cancel,
        onConfirm: async () => {
          await ctx.settings.update((x) => ({
            ...x,
            places: x.places.filter((p) => p.id !== existing.id),
            favorites: x.favorites.filter((f) => !(f.kind === 'trip' && [f.from, f.to].some((e) => e.type === 'place' && e.placeId === existing.id))),
          }));
          ctx.go('#/lieux');
        },
      })
    : null;
  if (existing) confirmSpot();
  sync();
  return h(
    'div',
    { class: 'screen' },
    header(ctx, isNew ? 'Nouveau lieu' : existing!.label, undefined, { label: 'Mes lieux', hash: '#/lieux' }),
    h('div', { class: 'field' }, h('label', { for: 'pl-name' }, 'Nom du lieu'), name, nameShortcuts(name)),
    verify,
    field.el,
    where,
    here,
    live.el,
    privacyNote(),
    save,
    hint,
    del,
  );
}
