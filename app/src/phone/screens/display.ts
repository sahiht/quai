/**
 * Réglage 4 sur 6 : affichage (T5), avec aperçu en direct de l'accueil des lunettes et de ses favoris. Maquette Config4.
 * 1.2.3 (PRD-1.2.3 § 1) : plus de « Départs par arrêt », les tableaux montrent tous les départs des 2 prochaines heures
 * (la valeur enregistrée, display.depsPerStop, reste et n'est plus lue).
 * 1.2.9 (PRD-1.2.9 § 2.4) : retour à Réglages, l'aperçu en haut, puis deux groupes : « Accueil des lunettes » (rayon de
 * « Autour de moi », ordre des favoris, ouverture de Quai) et « Sur tous les écrans » (aides de gestes, signe « ~ »,
 * pluie). Mêmes réglages, mêmes valeurs enregistrées.
 * 1.2.10 (PRD-1.2.10 § 4.4, maquette C de la 1.2.9) : tout tient sur un écran de 390 × 844 : « Ordre des favoris » en
 * deux choix côte à côte, « À l’ouverture de Quai » sur son écran (#/affichage/ouverture), sa valeur sur la ligne qui
 * l'ouvre ; l'aperçu se lit par son nom (« Aperçu dans les lunettes : … »). Ouvert depuis l'accueil (?retour=accueil),
 * Affichage y revient, et l'écran de l'ouverture revient à cet Affichage-là.
 * 1.3.1 (PRD-1.3.1 § 14, R5) : « Plein soleil » dans « Sur tous les écrans », après la pluie ; l'aperçu le suit. Avec ce
 * quatrième interrupteur, Affichage dépasse 390 × 844 d'environ 55 px (arbitrage signalé, test de display.test.ts).
 */
import type { Settings } from '../../core/api';
import { header, type PhoneCtx } from '../app';
import { h } from '../dom';
import { homePreview } from '../samples';
import { OPENING_LABEL, OPENING_ORDER, T, typo } from '../text';
import { glassesPreview, group, navRow, radios, segmented, switchRow } from '../ui';

/** Nom de l'aperçu (lu par les lecteurs d'écran, avec ce qu'il montre). */
const PREVIEW_TITLE = 'Aperçu dans les lunettes';

/** Aperçu de l'accueil des lunettes, redessiné à chaque réglage enregistré. */
function livePreview(ctx: PhoneCtx): { el: HTMLElement; refresh(): void } {
  const el = h('div', { class: 'preview-top' });
  const refresh = (): void => {
    // 1.3.1 (R5) : l'aperçu suit « Plein soleil »
    const s = ctx.settings.get();
    el.replaceChildren(glassesPreview(PREVIEW_TITLE, homePreview(s), { hiddenTitle: true, sun: s.display.sun === true }));
  };
  refresh();
  return { el, refresh };
}

/** Enregistre un réglage d'Affichage, puis `then` (l'aperçu suit). */
function setDisplay(ctx: PhoneCtx, fn: (d: Settings['display']) => Settings['display'], then: () => void): void {
  void ctx.settings.update((x) => ({ ...x, display: fn({ ...x.display }) })).then(then);
}

/** Affichage ouvert depuis l'accueil (?retour=accueil) : le paramètre suit vers l'écran de l'ouverture et en revient. */
const fromHome = (ctx: PhoneCtx): boolean => ctx.params.get('retour') === 'accueil';

export function displayScreen(ctx: PhoneCtx): HTMLElement {
  const s = ctx.settings.get();
  const preview = livePreview(ctx);
  const set = (fn: (d: Settings['display']) => Settings['display']): void => setDisplay(ctx, fn, preview.refresh);
  return h(
    'div',
    { class: 'screen display' },
    header(ctx, T.display, undefined, fromHome(ctx) ? { label: 'Accueil', hash: '#/' } : { label: T.settings, hash: '#/reglages' }),
    preview.el,
    group(
      'af-accueil',
      T.groupHome,
      h(
        'div',
        { class: 'box' },
        h(
          'div',
          { class: 'pad-row' },
          segmented<300 | 500 | 800>({
            legend: typo('Rayon de « Autour de moi »'),
            value: s.display.radiusM,
            options: [
              { value: 300, label: typo('300 m') },
              { value: 500, label: typo('500 m') },
              { value: 800, label: typo('800 m') },
            ],
            onChange: (v) => set((d) => ({ ...d, radiusM: v })),
          }),
        ),
        h(
          'div',
          { class: 'pad-row bordered' },
          // 1.2.10 : deux choix côte à côte (maquette C), le nom complet du premier pour les lecteurs d'écran
          segmented<Settings['display']['favOrder']>({
            legend: 'Ordre des favoris',
            value: s.display.favOrder,
            options: [
              { value: 'smart', label: 'Automatique', aria: 'Automatique, selon l’heure et ta position' },
              { value: 'mine', label: 'Dans mon ordre' },
            ],
            onChange: (v) => set((d) => ({ ...d, favOrder: v })),
          }),
        ),
        // 1.2.10 : l'ouverture de Quai sur son écran, sa valeur ici
        h('ul', { class: 'list bordered opening-link' }, navRow({ href: fromHome(ctx) ? '#/affichage/ouverture?retour=accueil' : '#/affichage/ouverture', icon: null, title: T.opening, sub: OPENING_LABEL[s.display.opening] })),
      ),
    ),
    group(
      'af-ecrans',
      T.groupAll,
      h(
        'div',
        { class: 'box' },
        h('div', null, switchRow({ label: 'Aides de gestes', sub: 'rappel discret en bas de l’écran', checked: s.display.gestureHints, onChange: (v) => set((d) => ({ ...d, gestureHints: v })) })),
        // 1.2.10 : sous-titre sur une ligne (tout tient sur un écran), même sens
        h('div', { class: 'bordered' }, switchRow({ label: 'Signaler les horaires prévus', sub: 'un ~ devant l’heure sans temps réel', checked: s.display.markPlanned, onChange: (v) => set((d) => ({ ...d, markPlanned: v })) })),
        // 1.2.5 : pluie prévue sur les marches de 5 min ou plus (grille fixe de la Belgique : la position n'est pas envoyée)
        h('div', { class: 'bordered' }, switchRow({ label: 'Pluie pendant la marche', sub: 'sur les marches de 5 min ou plus, d’après Open-Meteo', checked: s.display.rain, onChange: (v) => set((d) => ({ ...d, rain: v })) })),
        // 1.3.1 (PRD-1.3.1 § 14, R5) : « Plein soleil », éteint par défaut (seul `true` est enregistré) ; l'aperçu le suit
        h('div', { class: 'bordered' }, switchRow({ label: 'Plein soleil', sub: 'Le texte pâle devient plus clair.', checked: s.display.sun === true, onChange: (v) => set((d) => ({ ...d, sun: v })) })),
      ),
    ),
  );
}

/**
 * 1.2.10 (PRD-1.2.10 § 4.4) : « À l’ouverture de Quai » (#/affichage/ouverture), ses trois choix (libellés de la revue
 * d'usage n° 11, mêmes valeurs enregistrées), enregistrés tout de suite ; l'aperçu au-dessus montre l'effet (« L’accueil,
 * sans favoris » : aucun favori sous « Favoris »). Retour à Affichage.
 */
export function openingScreen(ctx: PhoneCtx): HTMLElement {
  const preview = livePreview(ctx);
  return h(
    'div',
    { class: 'screen display opening' },
    header(ctx, T.opening, T.openingLead, { label: T.display, hash: fromHome(ctx) ? '#/affichage?retour=accueil' : '#/affichage' }),
    preview.el,
    h(
      'div',
      { class: 'box pad-row tight' },
      radios<Settings['display']['opening']>({
        legend: T.opening,
        hiddenLegend: true,
        value: ctx.settings.get().display.opening,
        options: OPENING_ORDER.map((v) => ({ value: v, label: OPENING_LABEL[v] })),
        onChange: (v) => setDisplay(ctx, (d) => ({ ...d, opening: v }), preview.refresh),
      }),
    ),
  );
}
