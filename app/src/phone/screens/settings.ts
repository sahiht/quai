/**
 * Réglages (#/reglages, 1.2.9, PRD-1.2.9 § 2.3) : tous les réglages qui ne sont pas sur l'accueil, derrière son bouton
 * « Réglages ». « Dans les lunettes » : Affichage (rayon, signe « ~ », pluie) et Alertes (avec le seuil du retard) ;
 * 1.2.10 (PRD-1.2.10 § 4.1) : « Pendant un trajet » : « Me guider pendant un trajet », allumé par défaut, lu par les
 * lunettes dès qu'il change (réglages partagés) ; « Tes trajets » : « Marche maximale » et « Marge avant de partir »
 * réglables sur place (les pas-à-pas de l'écran Trajets), puis « Position et langue » ; « Quai » : Données ; en bas, les
 * sources des horaires. Favoris, gares, lignes et arrêts se règlent sur l'accueil. Affichage, Alertes, Données et
 * Position et langue reviennent ici.
 * 1.3.0 (PRD-1.3.0 § 6.1) : sous « Me guider pendant un trajet », le bouton « Tester l’écran des lunettes » (pas dans
 * Quai Web, ni avec des lunettes qui ne savent pas le faire), et dessous, pâle, le dernier résultat s'il existe.
 */
import { guideOn } from '../../settings';
import { header, type PhoneCtx } from '../app';
import { h, icon } from '../dom';
import { alertsSummary, displaySummary, LANG_TEXT, T, TEST_LAST, typo } from '../text';
import { group, navRow, nextId, switchRow } from '../ui';
import { openDisplayTest } from './display-test';
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

/**
 * 1.2.10 : interrupteur « Me guider pendant un trajet » et son aide (texte du PRD § 4.1). Enregistré tout de suite :
 * les lunettes le suivent comme les autres réglages. Nom : le libellé ; l'aide le décrit (lecteurs d'écran).
 */
function guideSwitch(ctx: PhoneCtx): HTMLElement {
  const row = switchRow({
    label: T.guide,
    sub: typo(T.guideHelp),
    checked: guideOn(ctx.settings.get()),
    onChange: (on) => void ctx.settings.update((x) => ({ ...x, display: { ...x.display, guide: on } })),
  });
  const id = nextId('guide');
  row.querySelector('.c1')!.id = `${id}-nom`;
  row.querySelector('.c2')!.id = `${id}-aide`;
  const input = row.querySelector('input')!;
  input.setAttribute('aria-labelledby', `${id}-nom`);
  input.setAttribute('aria-describedby', `${id}-aide`);
  return row;
}

/**
 * 1.3.0 (PRD-1.3.0 § 6.1) : bouton « Tester l’écran des lunettes » : l'écran du test, qui commence aussitôt. Dessous,
 * pâle, le dernier résultat (Settings.display.alert) s'il existe, qui décrit aussi le bouton. Quai Web (pas de vraies
 * lunettes) ou lunettes sans test (appli plus ancienne) : rien.
 */
function displayTestRow(ctx: PhoneCtx): HTMLElement | null {
  if (ctx.web) return null;
  let can = false;
  try {
    can = typeof ctx.glasses()?.displayTest === 'function';
  } catch {
    can = false;
  }
  if (!can) return null;
  const alert = ctx.settings.get().display.alert;
  const id = nextId('test-ecran');
  const last = alert && TEST_LAST[alert] ? h('p', { class: 'small muted test-last', id: `${id}-dernier` }, TEST_LAST[alert]) : null;
  const button = h('button', { type: 'button', class: 'btn btn-secondary btn-block test-open', 'aria-describedby': last ? last.id : undefined }, T.testScreen);
  button.addEventListener('click', () => openDisplayTest(ctx));
  return h('div', { class: 'test-row' }, button, last);
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
    group('rg-guidage', T.groupDuringTrip, h('div', { class: 'box' }, guideSwitch(ctx), displayTestRow(ctx))),
    group(
      'rg-trajets',
      T.groupTrips,
      h('div', { class: 'box' }, tripSteppers(ctx), stepsSwitch(ctx), h('ul', { class: 'list bordered' }, navRow({ href: '#/bienvenue', icon: icon('lang'), title: T.placeLang, sub: LANG_TEXT[s.lang] }))),
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

/**
 * 1.3.1 (PRD-1.3.1 § 14, R4) : interrupteur « Éviter les escaliers », avec la marche maximale et la marge (carte « Tes
 * trajets »), éteint par défaut, et sa ligne pâle. Enregistré tout de suite (Settings.avoidSteps, seul `true` est
 * gardé) : le prochain chemin à pied du guidage évite les marches quand il le peut (core/walk/router.ts). Nommé par son
 * libellé, décrit par sa ligne pâle (lecteurs d'écran), comme « Me guider pendant un trajet ».
 */
function stepsSwitch(ctx: PhoneCtx): HTMLElement {
  const row = switchRow({
    label: 'Éviter les escaliers',
    sub: typo('Un chemin sans marches quand il existe (poussette, valise).'),
    checked: ctx.settings.get().avoidSteps === true,
    onChange: (on) => void ctx.settings.update((x) => ({ ...x, avoidSteps: on })),
  });
  const id = nextId('escaliers');
  row.querySelector('.c1')!.id = `${id}-nom`;
  row.querySelector('.c2')!.id = `${id}-aide`;
  const input = row.querySelector('input')!;
  input.setAttribute('aria-labelledby', `${id}-nom`);
  input.setAttribute('aria-describedby', `${id}-aide`);
  return h('div', { class: 'bordered steps-switch' }, row);
}
