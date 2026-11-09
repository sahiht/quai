/** Réglage 4 sur 6 : affichage, avec aperçu en direct des lunettes. Maquette Config4. */
import type { Settings } from '../../core/api';
import { LIMITS } from '../../settings';
import { header, type PhoneCtx } from '../app';
import { h } from '../dom';
import { displayPreview } from '../samples';
import { glassesPreview, radios, segmented, stepper, switchRow } from '../ui';

export function displayScreen(ctx: PhoneCtx): HTMLElement {
  const s = ctx.settings.get();
  const previewSlot = h('div');
  const refresh = (): void => {
    previewSlot.replaceChildren(glassesPreview('Aperçu dans les lunettes', displayPreview(ctx.settings.get())));
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
            { value: 300, label: '300 m' },
            { value: 500, label: '500 m' },
            { value: 800, label: '800 m' },
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
          { value: 'suggest', label: 'Suggestion selon l’heure et le lieu' },
          { value: 'home', label: 'Toujours l’accueil' },
          { value: 'firstFavorite', label: 'Toujours le premier favori' },
        ],
        onChange: (v) => set((d) => ({ ...d, opening: v })),
      }),
    ),
    previewSlot,
    h('p', { class: 'small muted' }, 'Dans les lunettes : l’écran suit ces réglages tout de suite.'),
  );
}
