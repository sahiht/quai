/**
 * Quai Web : port des lunettes (GlassesPort) au-dessus du canvas. Mêmes appels que le SDK Even
 * (page de départ, reconstruction, mise à jour d'un conteneur), mêmes signaux (gestes, premier plan,
 * arrière-plan) ; il n'y a rien à quitter.
 */
import type { HubSignal } from '../glasses/gestures';
import type { ContainerSpec } from '../glasses/types';
import type { GlassesPort } from '../platform/types';

export interface WebGlassesPort extends GlassesPort {
  /** Envoie un signal comme le ferait l'hôte Even (geste, page cachée ou visible). */
  emit(s: HubSignal): void;
  /** Conteneurs affichés. */
  containers(): readonly ContainerSpec[];
}

export function createWebGlassesPort(screen: { paint(cs: readonly ContainerSpec[]): void }): WebGlassesPort {
  let current: ContainerSpec[] = [];
  const listeners = new Set<(s: HubSignal) => void>();
  const show = (cs: ContainerSpec[]): boolean => {
    current = cs.map((c) => ({ ...c }));
    screen.paint(current);
    return true;
  };
  return {
    async start(cs) {
      return show(cs);
    },
    async rebuild(cs) {
      return show(cs);
    },
    async upgrade(c, o) {
      current = current.map((x) => (x.id === c.id ? { ...x, ...(o.content ? { content: c.content } : {}), ...(o.level ? { level: c.level } : {}) } : x));
      screen.paint(current);
      return true;
    },
    onSignal(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async exit() {
      /* rien à fermer sur le web : le contrôleur affiche un message à la place */
    },
    emit(s) {
      for (const l of [...listeners]) l(s);
    },
    containers: () => current,
  };
}
