/**
 * PROVISOIRE (équipe C2, contrôleur) : remplaçant minimal des écrans du guidage de l'équipe C1 (PRD-1.2.10 § 3.2 à
 * 3.4, § 3.9), pour que le contrôleur compile et que la suite tourne avant leur livraison. À ÉCARTER à l'intégration au
 * profit de glasses/guide-views.ts de l'équipe C1 (mêmes signatures : GuideShow, GUIDE_MENU, guideView, menuView).
 * Les tests du contrôleur remplacent ce module par un double (vi.mock).
 */
import type { Journey } from '../core/api';
import type { GuideState } from '../core/guide-types';
import { hhmm } from '../core/util';
import { NB } from './format';
import { MENU_IDS, type GlassesView, type MenuItem } from './types';
import type { ViewCtx } from './views';

/** Ce que montre l'écran du guidage : rien, le moment du moteur, ou « Où tu en es ». */
export type GuideShow = 'empty' | 'moment' | 'where';

/** Les deux choix de l'appui long (PRD-1.2.10 § 3.4). */
export const GUIDE_MENU: MenuItem[] = [
  { id: MENU_IDS.stopGuide, label: 'Arrêter le guidage' },
  { id: MENU_IDS.allSteps, label: 'Voir tout le trajet' },
];

export function guideView(state: GuideState, show: GuideShow, _journey: Journey, ctx: ViewCtx): GlassesView {
  const m = state.moment;
  const lines = show === 'moment' && m ? [m.kind === 'arrived' ? 'Tu y es' : m.kind] : show === 'where' ? [`Arrivée ${hhmm(state.where.arr)}`] : [];
  const hints = show === 'empty' ? '' : m?.kind === 'arrived' && show === 'moment' ? `toucher${NB}: terminer` : `toucher${NB}: effacer   appui long${NB}: arrêter`;
  return {
    screen: 'guide',
    layout: 'guide',
    title: state.where.title,
    clock: hhmm(ctx.now),
    items: lines.map((a) => ({ a })),
    hints: ctx.settings.display.gestureHints ? hints : '',
    scroll: true,
    tap: { kind: 'guideTap' },
    menu: GUIDE_MENU,
    log: { show },
  };
}

export function menuView(items: MenuItem[], ctx: ViewCtx): GlassesView {
  return {
    screen: 'menu',
    layout: 'menu',
    title: 'Guidage',
    clock: hhmm(ctx.now),
    items: items.map((i) => ({ a: i.label, action: { kind: 'menu', id: i.id } })),
    hints: ctx.settings.display.gestureHints ? `△▽ choisir   toucher${NB}: choisir   double${NB}: retour` : '',
  };
}
