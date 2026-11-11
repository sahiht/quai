/**
 * Bouton « Lunettes » (PRD M2.9, M4.5, S8) : affiche un trajet (il devient le trajet suivi) ou les départs d'un arrêt
 * dans les lunettes, par GlassesApi (contrôleur des lunettes). Le message rendu s'affiche à côté du bouton touché ;
 * sur Quai Web, l'onglet Lunettes s'ouvre ensuite.
 */
import type { GlassesApi, LineFilter, TripRequest } from '../core/api';
import type { PhoneCtx } from './app';
import { h, ICON } from './dom';
import { T, typo } from './text';
import type { MessageHub } from './ui';


export interface GlassesResult {
  text: string;
  ok: boolean;
}

async function run(ctx: PhoneCtx, call: (g: GlassesApi) => Promise<string>): Promise<GlassesResult> {
  const g = ctx.glasses();
  if (!g) return { text: T.glassesOff, ok: false };
  try {
    const text = await call(g);
    ctx.showGlasses?.();
    return { text: text || 'Affiché dans les lunettes.', ok: true };
  } catch (e) {
    return { text: e instanceof Error && e.message ? e.message : T.glassesOff, ok: false };
  }
}

/** Affiche le trajet `req.index` de `req.result` dans les lunettes et le fait suivre. */
export const showTrip = (ctx: PhoneCtx, req: TripRequest): Promise<GlassesResult> => run(ctx, (g) => g.showTrip(req));

/** Affiche les départs d'un arrêt dans les lunettes. */
export const showBoard = (ctx: PhoneCtx, areaId: string, filter?: LineFilter[]): Promise<GlassesResult> => run(ctx, (g) => g.showBoard(areaId, filter));

/**
 * Bouton « Lunettes » et son emplacement de message. `aria` : nom pour les lecteurs d'écran
 * (« Afficher Le plus court dans les lunettes »).
 */
export function glassesButton(hub: MessageHub, aria: string, action: () => Promise<GlassesResult>): { button: HTMLButtonElement; message: HTMLParagraphElement } {
  const message = hub.slot();
  const button = h('button', { type: 'button', class: 'btn btn-glasses', 'aria-label': aria, html: `${ICON.glassesGreen}<span>${T.glasses}</span>` });
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const r = await action();
      hub.say(message, typo(r.text), !r.ok);
    } finally {
      button.disabled = false;
    }
  });
  return { button, message };
}
