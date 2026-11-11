/**
 * Premier lancement (T7) : étape 1 « Bienvenue » (position, langue des noms ; maquette Config1), puis étape 2
 * facultative « Tes lieux » (S1) : Maison et Bureau en champs uniques, et les trajets du matin et du soir.
 * Hors premier lancement, l'étape 1 sert d'écran « Position et langue ».
 */
import type { FavoriteTrip, NameLang, Place, Settings } from '../../core/api';
import { LIMITS, newId } from '../../settings';
import { APP_VERSION } from '../../version';
import { header, type PhoneCtx } from '../app';
import { h, ICON, liveRegion } from '../dom';
import { placeField, privacyNote, type FieldChoice } from '../field';
import { typo } from '../text';
import { radios } from '../ui';

export function onboardingScreen(ctx: PhoneCtx): HTMLElement {
  const s = ctx.settings.get();
  const first = !s.onboarded;
  let lang: NameLang = s.lang;
  const live = liveRegion();
  const allow = h('button', { type: 'button', class: 'btn btn-primary', html: `${ICON.pinWhite}<span>Autoriser la position</span>` });
  allow.addEventListener('click', async () => {
    allow.disabled = true;
    live.say('Demande de la position…');
    const fix = await ctx.location.current(10_000);
    allow.disabled = false;
    if (fix) live.say(typo('Position autorisée : « Autour de moi » est prêt.'));
    else live.say(typo('Position indisponible : autorise-la pour Quai dans l’appli Even Realities. Quai fonctionne sans, mais « Autour de moi » restera vide.'), true);
  });
  const save = h('button', { type: 'button', class: 'btn btn-dark btn-block', style: 'margin-top:8px' }, first ? 'Continuer' : 'Enregistrer');
  save.addEventListener('click', async () => {
    // La version vue est celle-ci : pas de message « Quai 1.1 » après une nouvelle installation (S2).
    await ctx.settings.update((x) => ({ ...x, lang, onboarded: true, seenVersion: first ? APP_VERSION : x.seenVersion }));
    ctx.go(first ? '#/bienvenue/lieux' : '#/?accueil=1');
  });
  // Quai Web : position du navigateur ou arrêt choisi (même rubrique que sous l'écran des lunettes).
  const position = ctx.positionPicker
    ? h(
        'section',
        { class: 'box pad', 'aria-labelledby': 'pos-title' },
        h('h2', { id: 'pos-title' }, 'Ta position'),
        h('p', { class: 'small', style: 'font-size:14px;line-height:20px' }, 'Elle sert à trouver les arrêts proches et à proposer le bon trajet. Quai la demande au navigateur et ne l’envoie nulle part.'),
        ctx.positionPicker(),
      )
    : h(
        'section',
        { class: 'box pad', 'aria-labelledby': 'pos-title' },
        h('h2', { id: 'pos-title' }, 'Ta position'),
        h('p', { class: 'small', style: 'font-size:14px;line-height:20px' }, 'Elle sert à trouver les arrêts proches et à proposer le bon trajet. Quai s’en sert sur le téléphone et ne l’enregistre nulle part.'),
        allow,
        live.el,
      );
  return h(
    'div',
    { class: 'screen' },
    first ? header(ctx, 'Bienvenue', 'Quelques réglages, et Quai est prêt.') : header(ctx, 'Position et langue', undefined, { label: 'Accueil', hash: '#/' }),
    position,
    h(
      'section',
      { class: 'box', style: 'padding:16px 16px 6px' },
      radios<NameLang>({
        legend: 'Noms des gares et arrêts',
        big: true,
        value: lang,
        options: [
          { value: 'fr', label: 'En français', sub: 'Bruxelles-Nord, Vilvorde' },
          { value: 'nl', label: 'En néerlandais', sub: 'Brussel-Noord, Vilvoorde' },
          { value: 'local', label: 'Comme sur place', sub: 'la langue de la région traversée' },
        ],
        onChange: (v) => (lang = v),
      }),
    ),
    save,
  );
}

/** Lieu tiré d'un choix du champ unique : adresse normalisée, ou arrêt (« Près de Namur »). Jamais de coordonnées affichées. */
export function placeFromChoice(id: string, label: string, c: FieldChoice): Place | null {
  if (c.kind === 'address') {
    const p: Place = { id, label, lat: c.lat, lon: c.lon, address: c.label, src: 'address' };
    if (c.approx) p.approx = true;
    return p;
  }
  if (c.kind === 'stop') return { id, label, lat: c.item.lat, lon: c.item.lon, address: `Près de ${c.label}`, src: 'stop', areaId: c.item.id };
  if (c.kind === 'place') return { ...c.place, id, label };
  return null;
}

/**
 * « Terminer » (S1) : crée les lieux choisis, et avec la case cochée les trajets « Ma position » → Bureau le matin
 * et « Ma position » → Maison le soir. Les lieux de même nom sont remplacés (même identifiant).
 */
export function withYourPlaces(s: Settings, chosen: { maison?: FieldChoice; bureau?: FieldChoice }, trips: boolean): Settings {
  let places = [...s.places];
  let favorites = [...s.favorites];
  const ids: { maison?: string; bureau?: string } = {};
  // Lieux dans l'ordre Maison, Bureau ; trajets dans l'ordre du matin puis du soir.
  for (const [key, label] of [['maison', 'Maison'], ['bureau', 'Bureau']] as const) {
    const c = chosen[key];
    if (!c) continue;
    const same = places.find((p) => p.label.toLowerCase() === label.toLowerCase());
    if (!same && places.length >= LIMITS.places) continue;
    const place = placeFromChoice(same?.id ?? newId('lieu', places.map((p) => p.id)), label, c);
    if (!place) continue;
    places = same ? places.map((p) => (p.id === same.id ? place : p)) : [...places, place];
    ids[key] = place.id;
  }
  if (trips) {
    for (const [key, propose] of [['bureau', 'morning'], ['maison', 'evening']] as const) {
      const placeId = ids[key];
      if (!placeId || favorites.length >= LIMITS.favorites) continue;
      if (favorites.some((f) => f.kind === 'trip' && f.from.type === 'here' && f.to.type === 'place' && f.to.placeId === placeId)) continue;
      const fav: FavoriteTrip = { kind: 'trip', id: newId('fav', favorites.map((f) => f.id)), from: { type: 'here' }, to: { type: 'place', placeId }, propose };
      favorites = [...favorites, fav];
    }
  }
  return { ...s, places, favorites };
}

/** Étape 2 du premier lancement : « Tes lieux » (S1, T7). */
export function yourPlacesScreen(ctx: PhoneCtx): HTMLElement {
  const chosen: { maison?: FieldChoice; bureau?: FieldChoice } = {};
  const live = liveRegion();
  const field = (key: 'maison' | 'bureau', label: string, placeholder: string) =>
    placeField(ctx, {
      id: `s1-${key}`,
      label,
      placeholder,
      onPick: (c) => {
        chosen[key] = c;
        live.say('');
      },
      onEdit: () => {
        chosen[key] = undefined;
      },
    });
  const maison = field('maison', 'Maison', 'Adresse de ton domicile');
  const bureau = field('bureau', 'Bureau', 'Adresse de ton travail ou de ton école');
  maison.input.setAttribute('data-autofocus', '');
  const trips = h('input', { type: 'checkbox', checked: true });
  const done = h('button', { type: 'button', class: 'btn btn-dark btn-block' }, 'Terminer');
  const later = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, 'Plus tard');
  const finish = async (create: boolean): Promise<void> => {
    if (create) {
      // Un texte tapé sans choix dans la liste ne crée rien : on le dit plutôt que de l'ignorer.
      const pending = [maison, bureau].find((f) => f.input.value.trim() && !f.picked());
      if (pending) {
        live.say(`Choisis l’adresse de ${pending === maison ? 'Maison' : 'Bureau'} dans la liste, ou efface-la.`, true);
        pending.input.focus();
        return;
      }
    }
    await ctx.settings.update((x) => ({ ...(create ? withYourPlaces(x, chosen, trips.checked) : x), onboarded: true, seenVersion: APP_VERSION }));
    ctx.go('#/?accueil=1');
  };
  done.addEventListener('click', () => void finish(true));
  later.addEventListener('click', () => void finish(false));
  return h(
    'div',
    { class: 'screen' },
    header(ctx, 'Tes lieux', 'Facultatif. Avec ces deux adresses, Quai te propose le bon trajet le matin et le soir.'),
    h('section', { class: 'box pad' }, maison.el, bureau.el, privacyNote()),
    h('label', { class: 'choice check-row' }, trips, 'Me proposer le trajet vers le bureau le matin, et vers la maison le soir'),
    live.el,
    done,
    later,
  );
}
