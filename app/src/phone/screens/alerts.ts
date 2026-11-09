/** Réglage 5 sur 6 : alertes, avec exemple dans les lunettes. Maquette Config5. */
import type { Settings } from '../../core/api';
import { LIMITS } from '../../settings';
import { header, type PhoneCtx } from '../app';
import { h } from '../dom';
import { alertsPreview } from '../samples';
import { glassesPreview, stepper, switchRow } from '../ui';

export function alertsScreen(ctx: PhoneCtx): HTMLElement {
  const s = ctx.settings.get();
  const previewSlot = h('div');
  const refresh = (): void => {
    previewSlot.replaceChildren(glassesPreview('Exemple dans les lunettes', alertsPreview(ctx.settings.get())));
  };
  const set = (fn: (a: Settings['alerts']) => Settings['alerts']): void => {
    void ctx.settings.update((x) => ({ ...x, alerts: fn({ ...x.alerts }) })).then(refresh);
  };
  const delaySub = (v: number): string => `à partir de ${v} min`;
  const leaveSub = (v: number): string => `${v} min avant l’heure conseillée`;
  const delayRow = switchRow({ label: 'Retard', sub: delaySub(s.alerts.delayMin), checked: s.alerts.delay, onChange: (v) => set((a) => ({ ...a, delay: v })) });
  const leaveRow = switchRow({ label: 'Heure de partir à pied', sub: leaveSub(s.alerts.leaveBeforeMin), checked: s.alerts.leave, onChange: (v) => set((a) => ({ ...a, leave: v })) });
  const subOf = (row: HTMLElement): HTMLElement | null => row.querySelector('.c2');
  refresh();
  return h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:16px' },
    header(ctx, 'Alertes', 'Une ligne en tête de l’écran des lunettes, pendant un trajet suivi.', { label: 'Accueil', hash: '#/' }),
    h(
      'div',
      { class: 'box' },
      switchRow({ label: 'Changement de voie', checked: s.alerts.platform, onChange: (v) => set((a) => ({ ...a, platform: v })) }),
      h('div', { class: 'bordered' }, delayRow),
      stepper({
        label: 'Seuil du retard',
        value: s.alerts.delayMin,
        min: LIMITS.delayMin[0],
        max: 30,
        format: (v) => `${v} min`,
        less: 'Seuil de retard plus bas',
        more: 'Seuil de retard plus haut',
        onChange: (v) => {
          const el = subOf(delayRow);
          if (el) el.textContent = delaySub(v);
          set((a) => ({ ...a, delayMin: v }));
        },
      }),
      h('div', { class: 'bordered' }, switchRow({ label: 'Train, tram ou bus supprimé', checked: s.alerts.cancel, onChange: (v) => set((a) => ({ ...a, cancel: v })) })),
      h('div', { class: 'bordered' }, leaveRow),
      stepper({
        label: 'Marge avant de partir',
        value: s.alerts.leaveBeforeMin,
        min: LIMITS.leaveBeforeMin[0],
        max: LIMITS.leaveBeforeMin[1],
        format: (v) => `${v} min`,
        less: 'Marge plus courte',
        more: 'Marge plus longue',
        onChange: (v) => {
          const el = subOf(leaveRow);
          if (el) el.textContent = leaveSub(v);
          set((a) => ({ ...a, leaveBeforeMin: v }));
        },
      }),
      h('div', { class: 'bordered' }, switchRow({ label: 'Travaux et déviations', sub: 'sur tes lignes favorites', checked: s.alerts.works, onChange: (v) => set((a) => ({ ...a, works: v })) })),
    ),
    previewSlot,
  );
}
