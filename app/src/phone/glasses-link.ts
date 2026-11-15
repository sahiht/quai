/**
 * Bouton « Lunettes » (PRD M2.9, M4.5, S8) : affiche un trajet (il devient le trajet suivi) ou les départs d'un arrêt
 * dans les lunettes, par GlassesApi (contrôleur des lunettes). Le message rendu s'affiche à côté du bouton touché ;
 * sur Quai Web, l'onglet Lunettes s'ouvre ensuite.
 * 1.2.10 (PRD-1.2.10 § 4.2) : bouton « Y aller » d'un favori (GlassesApi.goFavorite : son trajet calculé, le guidage
 * lancé), seulement si les lunettes le savent (appli 1.2.10 ou plus récente) ; son message au même endroit.
 */
import type { GlassesApi, LineFilter, TripRequest } from '../core/api';
import { guideOn } from '../settings';
import type { PhoneCtx } from './app';
import { h, ICON } from './dom';
import { T, typo } from './text';
import type { MessageHub } from './ui';

export interface GlassesResult {
  text: string;
  ok: boolean;
}

/** Appelle les lunettes ; `fallback` : le message quand elles n'en rendent pas. */
async function run(ctx: PhoneCtx, call: (g: GlassesApi) => Promise<string>, fallback = 'Affiché dans les lunettes.'): Promise<GlassesResult> {
  const g = ctx.glasses();
  if (!g) return { text: T.glassesOff, ok: false };
  try {
    const text = await call(g);
    ctx.showGlasses?.();
    return { text: text || fallback, ok: true };
  } catch (e) {
    return { text: e instanceof Error && e.message ? e.message : T.glassesOff, ok: false };
  }
}

/** Affiche le trajet `req.index` de `req.result` dans les lunettes et le fait suivre. */
export const showTrip = (ctx: PhoneCtx, req: TripRequest): Promise<GlassesResult> => run(ctx, (g) => g.showTrip(req));

/** Affiche les départs d'un arrêt dans les lunettes. */
export const showBoard = (ctx: PhoneCtx, areaId: string, filter?: LineFilter[]): Promise<GlassesResult> => run(ctx, (g) => g.showBoard(areaId, filter));

/** 1.2.10 : les lunettes savent lancer le guidage d'un favori (« Y aller ») : sinon, pas de bouton. */
export const canGo = (ctx: Pick<PhoneCtx, 'glasses'>): boolean => typeof ctx.glasses()?.goFavorite === 'function';

/**
 * 1.2.10 : « Y aller » sur le favori `id` : les lunettes calculent son trajet et lancent le guidage (réglage éteint :
 * le trajet est suivi sans message). Leur message, sinon « Guidage lancé sur les lunettes. ».
 */
export const goFavorite = (ctx: PhoneCtx, id: string): Promise<GlassesResult> =>
  run(ctx, (g) => (g.goFavorite ? g.goFavorite(id) : Promise.reject(new Error(T.glassesOff))), guideOn(ctx.settings.get()) ? T.guideStarted : T.followStarted);

/** Le bouton touché attend la réponse des lunettes (grisé), puis leur message s'affiche dans `slot`. */
function wire(button: HTMLButtonElement, hub: MessageHub, slot: HTMLElement, action: () => Promise<GlassesResult>): void {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const r = await action();
      hub.say(slot, typo(r.text), !r.ok);
    } finally {
      button.disabled = false;
    }
  });
}

/**
 * Bouton « Lunettes » et son emplacement de message. `aria` : nom pour les lecteurs d'écran
 * (« Afficher Le plus court dans les lunettes »). 1.2.10 : `compact` : l'icône seule (44 × 44), à côté de « Y aller ».
 */
export function glassesButton(hub: MessageHub, aria: string, action: () => Promise<GlassesResult>, opts: { compact?: boolean } = {}): { button: HTMLButtonElement; message: HTMLParagraphElement } {
  const message = hub.slot();
  const button = opts.compact
    ? h('button', { type: 'button', class: 'btn btn-glasses btn-icon', 'aria-label': aria, title: T.glasses, html: ICON.glassesGreen })
    : h('button', { type: 'button', class: 'btn btn-glasses', 'aria-label': aria, html: `${ICON.glassesGreen}<span>${T.glasses}</span>` });
  wire(button, hub, message, action);
  return { button, message };
}

/**
 * 1.2.10 : bouton « Y aller » d'un favori ; son message dans `slot` (celui de la rangée). `aria` : nom pour les
 * lecteurs d'écran, qui commence par « Y aller » (« Y aller : Bureau »).
 */
export function goButton(hub: MessageHub, slot: HTMLElement, aria: string, action: () => Promise<GlassesResult>): HTMLButtonElement {
  const button = h('button', { type: 'button', class: 'btn btn-go', 'aria-label': aria }, T.goThere);
  wire(button, hub, slot, action);
  return button;
}
