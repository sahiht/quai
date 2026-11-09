/** Accueil du téléphone : recherche, réglages, état des données. */
import type { PhoneCtx } from '../app';
import { h, icon, ICON } from '../dom';
import { listRow } from '../ui';

const LANG_TEXT = { fr: 'Noms en français', nl: 'Noms en néerlandais', local: 'Noms comme sur place' } as const;

export function homeScreen(ctx: PhoneCtx): HTMLElement {
  const s = ctx.settings.get();
  const fresh = ctx.freshness();
  const err = ctx.coreError();
  const n = s.favorites.length;
  const dataSub = !ctx.configured ? 'Appli non configurée' : err ? 'Connexion à vérifier' : fresh && !fresh.ok ? 'Horaires périmés' : 'Tout est à jour';
  return h(
    'div',
    { class: 'stack', style: 'display:flex;flex-direction:column;gap:16px' },
    h('header', { class: 'head' }, h('span', { class: 'eyebrow' }, 'Quai'), h('h1', null, 'Bonjour'), h('p', { class: 'lead' }, 'Les départs en direct s’affichent dans tes lunettes.')),
    !ctx.configured
      ? h('div', { class: 'warn', role: 'alert' }, h('strong', null, 'Quai n’est pas configuré.'), 'Les adresses des horaires et du relais manquent : lancez « npm run configure » avant de créer le paquet.')
      : fresh && !fresh.ok
        ? h('div', { class: 'warn', role: 'alert' }, h('strong', null, fresh.message ?? 'Horaires périmés'), h('a', { href: '#/donnees' }, 'Voir l’écran Données'))
        : null,
    h('button', { type: 'button', class: 'btn btn-primary btn-big btn-block', onclick: () => ctx.go('#/recherche'), html: `${ICON.search}<span>Rechercher un trajet</span>` }),
    h('h2', null, 'Réglages'),
    h(
      'ul',
      { class: 'list box', style: 'background:#fff' },
      listRow({ icon: icon('lang'), title: 'Position et langue', sub: LANG_TEXT[s.lang], onClick: () => ctx.go('#/bienvenue') }),
      listRow({ icon: icon('home'), title: 'Mes lieux', sub: s.places.length ? s.places.map((p) => p.label).join(', ') : 'Aucun lieu', onClick: () => ctx.go('#/lieux') }),
      listRow({ icon: icon('trip'), title: 'Mes favoris', sub: n ? `${n} favori${n > 1 ? 's' : ''}` : 'Aucun favori', onClick: () => ctx.go('#/favoris') }),
      listRow({ icon: icon('display'), title: 'Affichage', sub: `${s.display.depsPerStop} départs par arrêt, rayon ${s.display.radiusM} m`, onClick: () => ctx.go('#/affichage') }),
      listRow({ icon: icon('alert'), title: 'Alertes', sub: alertsSummary(s.alerts), onClick: () => ctx.go('#/alertes') }),
      listRow({ icon: icon('data'), title: 'Données', sub: dataSub, onClick: () => ctx.go('#/donnees') }),
    ),
    h('p', { class: 'foot' }, 'Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company'),
  );
}

function alertsSummary(a: { platform: boolean; delay: boolean; cancel: boolean; leave: boolean; works: boolean }): string {
  const on = [a.platform && 'voie', a.delay && 'retard', a.cancel && 'suppression', a.leave && 'départ à pied', a.works && 'travaux'].filter(Boolean) as string[];
  if (!on.length) return 'Aucune alerte';
  const t = on.join(', ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
