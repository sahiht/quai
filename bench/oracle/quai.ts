/**
 * Accès aux modules de Quai, chargés depuis QUAI_ROOT (par défaut ce dépôt ; pour mesurer exactement la 1.2.1 :
 * QUAI_ROOT=/tmp/quai-121, copie de `git archive c50fd22 app/src shared`).
 *
 * L'oracle (net.ts, search.ts) n'utilise ici que le modèle de marche et les constantes du modèle (util.ts : distance,
 * minutes de marche, origine du jour de service ; params.ts : 400 m, temps de correspondance, attente de 60 min au
 * plus, 3 véhicules, une seule correspondance entre deux lignes urbaines). Le moteur (engine.ts) et le classement
 * (rank.ts, reason.ts) ne servent qu'à mesurer la 1.2.1 et à rejouer sa règle (F0*), jamais à l'oracle.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Dépôt mesuré : QUAI_ROOT, sinon celui de ce banc (bench/oracle/../..). */
export const QUAI_ROOT = process.env.QUAI_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const core = (p: string) => join(QUAI_ROOT, 'app/src/core', p);

/* eslint-disable @typescript-eslint/no-explicit-any */
export const util: any = await import(core('util.ts'));
export const params: any = await import(core('routing/params.ts'));
export const engine: any = await import(core('routing/engine.ts'));
export const rankMod: any = await import(core('routing/rank.ts'));
export const reasonMod: any = await import(core('routing/reason.ts'));
export const api: any = await import(core('api.ts'));
export const rtmerge: any = await import(core('rtmerge.ts'));

export const P = params.P as Record<string, any>;
export const MIN = 60_000;

export interface Names {
  fr: string;
  nl: string;
}
