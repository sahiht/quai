/**
 * Réglages (#/reglages, 1.2.9, PRD-1.2.9 § 2.3) : tous les réglages qui ne sont pas sur l'accueil, derrière son bouton
 * « Réglages ». « Dans les lunettes » : Affichage (rayon, signe « ~ », pluie) et Alertes (avec le seuil du retard) ;
 * « Tes trajets » : « Marche maximale » et « Marge avant de partir » réglables sur place (les pas-à-pas de l'écran
 * Trajets), puis « Position et langue » ; « Quai » : Données ; en bas, les sources des horaires. Favoris, gares, arrêts
 * et lignes se règlent sur l'accueil. Affichage, Alertes, Données et Position et langue reviennent ici.
 */
import { header, type PhoneCtx } from '../app';
import { h, icon } from '../dom';
import { alertsSummary, displaySummary, LANG_TEXT, T, typo } from '../text';
import { group, navRow } from '../ui';
import { ANSWER_REFRESH_MS } from './home';
import { tripSteppers } from './trips';

/** Sous-titre de la ligne « Données » (T1) : panne du temps réel dite juste (M8). */
export function dataSubtitle(ctx: PhoneCtx): string {
  const fresh = ctx.freshness();
  if (!ctx.configured) return 'Appli non configurée';
  if (ctx.coreError()) return 'Connexion à vérifier';
  if (fresh && !fresh.ok) return 'Horaires périmés';
  const rt = ctx.coreNow()?.status?.().rt;
  if (rt === 'down') return T.rtDown;
  if (rt === 'offline') return typo(T.offline);
  return 'Tout est à jour';
}

export function settingsScreen(ctx: PhoneCtx): HTMLElement {
  const s = ctx.settings.get();
  const data = navRow({ href: '#/donnees', icon: icon('data'), title: T.data, sub: dataSubtitle(ctx) });
  const el = h(
    'div',
    { class: 'screen settings' },
    header(ctx, T.settings, T.settingsLead, { label: 'Accueil', hash: '#/' }),
    group(
      'rg-lunettes',
      T.groupGlasses,
      h(
        'ul',
        { class: 'list box' },
        navRow({ href: '#/affichage', icon: icon('display'), title: T.display, sub: displaySummary(s.display) }),
        navRow({ href: '#/alertes', icon: icon('alert'), title: T.alerts, sub: alertsSummary(s.alerts) }),
      ),
    ),
    group(
      'rg-trajets',
      T.groupTrips,
      h('div', { class: 'box' }, tripSteppers(ctx), h('ul', { class: 'list bordered' }, navRow({ href: '#/bienvenue', icon: icon('lang'), title: T.placeLang, sub: LANG_TEXT[s.lang] }))),
    ),
    group('rg-quai', T.groupQuai, h('ul', { class: 'list box' }, data)),
    h('p', { class: 'foot sources' }, typo(T.sources)),
  );
  // L'état du temps réel change : le sous-titre de « Données » suit (toutes les 30 s, comme l'accueil).
  const sub = data.querySelector('.t2');
  const timer = setInterval(() => {
    if (!el.isConnected) clearInterval(timer);
    else if (sub) sub.textContent = dataSubtitle(ctx);
  }, ANSWER_REFRESH_MS);
  return el;
}
