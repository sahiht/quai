/**
 * « Trajets » (revue d'usage n° 9) : les deux réglages qui changent les trajets proposés, au même endroit. « Marche
 * maximale » (venue du bas de « Mes favoris ») et « Marge avant de partir » (venue de « Alertes » : elle est comprise
 * dans l'heure de départ conseillée, alerte coupée ou non). Mêmes clés de réglages (maxWalkMin,
 * alerts.leaveBeforeMin), aucune migration.
 */
import { LIMITS } from '../../settings';
import { header, type PhoneCtx } from '../app';
import { h } from '../dom';
import { T, typo } from '../text';
import { stepper } from '../ui';

export function tripsScreen(ctx: PhoneCtx): HTMLElement {
  const s = ctx.settings.get();
  return h(
    'div',
    { class: 'screen' },
    header(ctx, T.trips, undefined, { label: 'Accueil', hash: '#/' }),
    h(
      'div',
      { class: 'box' },
      stepper({
        label: T.maxWalk,
        sub: typo(T.maxWalkSub),
        value: s.maxWalkMin,
        min: LIMITS.maxWalkMin[0],
        max: LIMITS.maxWalkMin[1],
        format: (v) => typo(`${v} min`),
        less: 'Réduire la marche maximale',
        more: 'Augmenter la marche maximale',
        onChange: (v) => void ctx.settings.update((x) => ({ ...x, maxWalkMin: v })),
      }),
      stepper({
        label: T.margin,
        sub: typo(T.marginSub),
        value: s.alerts.leaveBeforeMin,
        min: LIMITS.leaveBeforeMin[0],
        max: LIMITS.leaveBeforeMin[1],
        format: (v) => typo(`${v} min`),
        less: 'Marge plus courte',
        more: 'Marge plus longue',
        onChange: (v) => void ctx.settings.update((x) => ({ ...x, alerts: { ...x.alerts, leaveBeforeMin: v } })),
      }),
    ),
  );
}
