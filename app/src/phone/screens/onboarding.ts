/**
 * Premier lancement (T7) : étape 1 « Bienvenue » (position, langue des noms ; maquette Config1), puis étape 2
 * facultative « Tes favoris » (S1, PRD-1.2 § 2.2) : Maison et Bureau en champs uniques deviennent deux lieux,
 * proposés le soir et le matin si la case est cochée. Hors premier lancement, l'étape 1 sert d'écran
 * « Position et langue ».
 */
import type { Favorite, FavoritePlace, NameLang, Propose, Settings } from '../../core/api';
import { APP_VERSION } from '../../version';
import { header, type PhoneCtx } from '../app';
import { h, ICON, liveRegion } from '../dom';
import { placeField, privacyNote, type FieldChoice } from '../field';
import { typo } from '../text';
import { radios } from '../ui';
import { makePlace, spotOf, withPlace } from './places';

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
    ctx.go(first ? '#/bienvenue/favoris' : '#/?accueil=1');
  });
  // Quai Web : position du navigateur, adresse ou arrêt choisi (même rubrique que sous l'écran des lunettes).
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
export function placeFromChoice(id: string, label: string, c: FieldChoice, propose: Propose = 'never'): FavoritePlace | null {
  const spot = spotOf(c);
  return spot ? makePlace(id, label, spot, propose) : null;
}

/**
 * « Terminer » (S1, PRD-1.2 § 2.2) : deux lieux, Maison et Bureau, sans autre favori. Case cochée : Bureau proposé le
 * matin, Maison le soir, dans cet ordre (celui des trajets du matin et du soir) ; sinon « Jamais », Maison d'abord.
 * Un lieu de même nom est remplacé à sa place (même identifiant).
 */
export function withYourPlaces(s: Settings, chosen: { maison?: FieldChoice; bureau?: FieldChoice }, slots: boolean): Settings {
  let favorites: Favorite[] = [...s.favorites];
  const order = slots
    ? ([['bureau', 'Bureau', 'morning'], ['maison', 'Maison', 'evening']] as const)
    : ([['maison', 'Maison', 'never'], ['bureau', 'Bureau', 'never']] as const);
  for (const [key, label, propose] of order) {
    const c = chosen[key];
    const place = c ? placeFromChoice('', label, c, propose) : null;
    const next = place ? withPlace(favorites, place) : null;
    if (next) favorites = next.favorites;
  }
  return { ...s, favorites };
}

/** Étape 2 du premier lancement : « Tes favoris » (S1, T7). */
export function yourFavoritesScreen(ctx: PhoneCtx): HTMLElement {
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
  const slots = h('input', { type: 'checkbox', checked: true });
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
    await ctx.settings.update((x) => ({ ...(create ? withYourPlaces(x, chosen, slots.checked) : x), onboarded: true, seenVersion: APP_VERSION }));
    ctx.go('#/?accueil=1');
  };
  done.addEventListener('click', () => void finish(true));
  later.addEventListener('click', () => void finish(false));
  return h(
    'div',
    { class: 'screen' },
    header(ctx, 'Tes favoris', 'Facultatif. Maison et bureau deviennent tes premiers favoris.'),
    h('section', { class: 'box pad' }, maison.el, bureau.el, privacyNote()),
    // 1.2.2 (revue d'usage n° 11) : le créneau met le favori en tête de l'accueil ; plus de « proposer ».
    h('label', { class: 'choice check-row' }, slots, 'Mettre le bureau en tête le matin, et la maison le soir'),
    live.el,
    done,
    later,
  );
}
