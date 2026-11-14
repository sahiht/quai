/**
 * « Trajets » (revue d'usage n° 9) : les deux réglages qui changent les trajets proposés, au même endroit. « Marche
 * maximale » (venue du bas de « Mes favoris ») et « Marge avant de partir » (venue de « Alertes » : elle est comprise
 * dans l'heure de départ conseillée, alerte coupée ou non). Mêmes clés de réglages (maxWalkMin,
 * alerts.leaveBeforeMin), aucune migration.
 * 1.2.9 (PRD-1.2.9 § 2.3) : les deux pas-à-pas sont aussi dans Réglages (« Tes trajets »), réglables sur place
 * (tripSteppers, le même code) ; #/trajets reste valable (ancien lien) et revient à Réglages.
 */
import { LIMITS } from '../../settings';
import { header, type PhoneCtx } from '../app';
import { h } from '../dom';
import { T, typo } from '../text';
import { stepper } from '../ui';

/** « Marche maximale » et « Marge avant de partir » : bornes de LIMITS, pas de 1 min, enregistrés tout de suite. */
export function tripSteppers(ctx: PhoneCtx): HTMLElement[] {
  const s = ctx.settings.get();
  return [
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
  ];
}

export function tripsScreen(ctx: PhoneCtx): HTMLElement {
  return h('div', { class: 'screen' }, header(ctx, T.trips, undefined, { label: T.settings, hash: '#/reglages' }), h('div', { class: 'box' }, tripSteppers(ctx)));
}
