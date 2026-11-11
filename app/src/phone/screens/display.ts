/** Réglage 4 sur 6 : affichage (T5), avec aperçu en direct de l'accueil des lunettes et de ses favoris. Maquette Config4. */
import type { Settings } from '../../core/api';
import { LIMITS } from '../../settings';
import { header, type PhoneCtx } from '../app';
import { h } from '../dom';
import { homePreview } from '../samples';
import { typo } from '../text';
import { glassesPreview, radios, segmented, stepper, switchRow } from '../ui';

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
      stepper({
        label: 'Départs par arrêt',
        value: s.display.depsPerStop,
        min: LIMITS.depsPerStop[0],
        max: LIMITS.depsPerStop[1],
        format: (v) => String(v),
        less: 'Un départ de moins',
        more: 'Un départ de plus',
        onChange: (v) => set((d) => ({ ...d, depsPerStop: v })),
      }),
      h(
        'div',
        { class: 'bordered', style: 'padding:12px 16px' },
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
    ),
    h(
      'div',
      { class: 'box', style: 'padding:12px 16px 2px' },
      radios<Settings['display']['opening']>({
        legend: 'À l’ouverture de Quai',
        value: s.display.opening,
        options: [
          { value: 'suggest', label: 'Mes favoris en tête, selon l’heure et le lieu' },
          { value: 'firstFavorite', label: 'Toujours ouvrir le favori en tête' },
          { value: 'home', label: 'Accueil sans favoris' },
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
          { value: 'smart', label: 'Selon l’heure et le lieu' },
          { value: 'mine', label: 'Dans mon ordre' },
        ],
        onChange: (v) => set((d) => ({ ...d, favOrder: v })),
      }),
    ),
    previewSlot,
    h('p', { class: 'small muted' }, typo('Dans les lunettes : l’écran suit ces réglages tout de suite.')),
  );
}
