/** Réglage 1 sur 6 : premier lancement (position, langue des noms). Maquette Config1. */
import type { NameLang } from '../../core/api';
import { header, type PhoneCtx } from '../app';
import { h, ICON, liveRegion } from '../dom';
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
    if (fix) live.say('Position autorisée : « Autour de moi » est prêt.');
    else live.say('Position indisponible : autorise-la pour Quai dans l’appli Even Realities. Quai fonctionne sans, mais « Autour de moi » restera vide.', true);
  });
  const save = h('button', { type: 'button', class: 'btn btn-dark btn-block', style: 'margin-top:8px' }, first ? 'Continuer' : 'Enregistrer');
  save.addEventListener('click', async () => {
    await ctx.settings.update((x) => ({ ...x, lang, onboarded: true }));
    ctx.go('#/?accueil=1');
  });
  return h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:16px' },
    first ? header(ctx, 'Bienvenue', 'Deux réglages, et Quai est prêt.') : header(ctx, 'Position et langue', undefined, { label: 'Accueil', hash: '#/' }),
    h(
      'section',
      { class: 'box pad', 'aria-labelledby': 'pos-title' },
      h('h2', { id: 'pos-title' }, 'Ta position'),
      h('p', { class: 'small', style: 'font-size:14px;line-height:20px' }, 'Elle sert à trouver les arrêts proches et à proposer le bon trajet. Quai s’en sert sur le téléphone et ne l’enregistre nulle part.'),
      allow,
      live.el,
    ),
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
