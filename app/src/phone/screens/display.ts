/**
 * Réglage 4 sur 6 : affichage (T5), avec aperçu en direct de l'accueil des lunettes et de ses favoris. Maquette Config4.
 * 1.2.3 (PRD-1.2.3 § 1) : plus de « Départs par arrêt », les tableaux montrent tous les départs des 2 prochaines heures
 * (la valeur enregistrée, display.depsPerStop, reste et n'est plus lue).
 */
import type { Settings } from '../../core/api';
import { header, type PhoneCtx } from '../app';
import { h } from '../dom';
import { homePreview } from '../samples';
import { typo } from '../text';
import { glassesPreview, radios, segmented, switchRow } from '../ui';

export function displayScreen(ctx: PhoneCtx): HTMLElement {
  const s = ctx.settings.get();
  const previewSlot = h('div');
  const refresh = (): void => {
    previewSlot.replaceChildren(glassesPreview('Aperçu dans les lunettes', homePreview(ctx.settings.get())));
  };
  const set = (fn: (d: Settings['display']) => Settings['display']): void => {
    void ctx.settings.update((x) => ({ ...x, display: fn({ ...x.display }) })).then(refresh);
  };
  refresh();
  return h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:14px' },
    header(ctx, 'Affichage', undefined, { label: 'Accueil', hash: '#/' }),
    h(
      'div',
      { class: 'box' },
      h(
        'div',
        { style: 'padding:12px 16px' },
        segmented<300 | 500 | 800>({
          legend: 'Rayon de « Autour de moi »',
          value: s.display.radiusM,
          options: [
            { value: 300, label: typo('300 m') },
            { value: 500, label: typo('500 m') },
            { value: 800, label: typo('800 m') },
          ],
          onChange: (v) => set((d) => ({ ...d, radiusM: v })),
        }),
      ),
      h('div', { class: 'bordered' }, switchRow({ label: 'Aides de gestes', sub: 'rappel discret en bas de l’écran', checked: s.display.gestureHints, onChange: (v) => set((d) => ({ ...d, gestureHints: v })) })),
      h('div', { class: 'bordered' }, switchRow({ label: 'Signaler les horaires prévus', sub: 'avec le signe ~ quand il n’y a pas de temps réel', checked: s.display.markPlanned, onChange: (v) => set((d) => ({ ...d, markPlanned: v })) })),
      // 1.2.5 : pluie prévue sur les marches de 5 min ou plus (grille fixe de la Belgique : la position n'est pas envoyée)
      h('div', { class: 'bordered' }, switchRow({ label: 'Pluie pendant la marche', sub: 'sur les marches de 5 min ou plus, d’après Open-Meteo', checked: s.display.rain, onChange: (v) => set((d) => ({ ...d, rain: v })) })),
    ),
    h(
      'div',
      { class: 'box', style: 'padding:12px 16px 2px' },
      // 1.2.2 (revue d'usage n° 11) : libellés revus, mêmes valeurs enregistrées.
      radios<Settings['display']['opening']>({
        legend: 'À l’ouverture de Quai',
        value: s.display.opening,
        options: [
          { value: 'suggest', label: 'L’accueil, avec mes favoris en tête' },
          { value: 'firstFavorite', label: 'Directement mon premier favori' },
          { value: 'home', label: 'L’accueil, sans favoris' },
        ],
        onChange: (v) => set((d) => ({ ...d, opening: v })),
      }),
    ),
    h(
      'div',
      { class: 'box', style: 'padding:12px 16px 2px' },
      radios<Settings['display']['favOrder']>({
        legend: 'Ordre des favoris',
        value: s.display.favOrder,
        options: [
          { value: 'smart', label: 'Automatique, selon l’heure et ta position' },
          { value: 'mine', label: 'Dans mon ordre' },
        ],
        onChange: (v) => set((d) => ({ ...d, favOrder: v })),
      }),
    ),
    previewSlot,
    h('p', { class: 'small muted' }, typo('Dans les lunettes : l’écran suit ces réglages tout de suite.')),
  );
}
