/**
 * 1.3.0 (PRD-1.3.0 § 6.1) : mouvement « lever la tête », appris pendant le test de l'écran des lunettes. Logique pure :
 * ni minuterie, ni accès au matériel ; le contrôleur donne les mesures du capteur de mouvement (signal `imu`).
 *
 * - Pendant l'attente (« ne touche à rien ») : la position de repos, moyenne et bruit (écart type) de chaque axe.
 * - Pendant la question (« Lève la tête ») : l'écart de chaque mesure à ce repos. Un écart compte s'il est tenu
 *   `HEADUP_HOLD` mesures de suite dans le même sens (un pic isolé ne compte pas) ; on garde le plus grand de chaque axe.
 * - Appris : l'axe qui change le plus par rapport au repos, son sens et son écart, seulement si cet écart vaut au moins
 *   trois fois le bruit du repos sur cet axe (changement net) et que le repos est connu (`HEADUP_REST_MIN` mesures).
 *
 * Confidentialité (PRD-1.3.0 § 10) : aucune mesure n'est gardée, seulement des sommes pour le repos et le plus grand écart
 * tenu par axe ; seul le mouvement appris (un axe, un sens, un écart) est enregistré dans les réglages.
 */
import type { Settings } from '../core/api';

/** Mouvement appris (Settings.display.headUp). */
export type HeadUpMove = NonNullable<Settings['display']['headUp']>;

/** Une mesure du capteur (valeurs brutes de l'hôte). */
export interface ImuSample {
  x: number;
  y: number;
  z: number;
}

const AXES = ['x', 'y', 'z'] as const;

/** Changement net : au moins trois fois le bruit du repos (PRD-1.3.0 § 6.1). */
export const HEADUP_NOISE_FACTOR = 3;
/** Écart tenu : 3 mesures de suite dans le même sens (0,3 s à une mesure toutes les 100 ms). */
export const HEADUP_HOLD = 3;
/** Repos connu : 10 mesures au moins (1 s à une mesure toutes les 100 ms). */
export const HEADUP_REST_MIN = 10;

const usable = (s: ImuSample): boolean => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z);

/** Apprentissage du mouvement « lever la tête » : `rest` pendant l'attente, `move` pendant la question, puis `result`. */
export class HeadUpLearner {
  /** Repos : nombre de mesures, moyenne et somme des carrés des écarts par axe (méthode de Welford). */
  private n = 0;
  private mean = [0, 0, 0];
  private m2 = [0, 0, 0];
  /** Mouvement : derniers écarts de chaque axe (HEADUP_HOLD au plus) et plus grand écart tenu, signé. */
  private recent: number[][] = [[], [], []];
  private peak = [0, 0, 0];

  /** Mesure pendant l'attente : la position de repos. */
  rest(s: ImuSample): void {
    if (!usable(s)) return;
    this.n++;
    AXES.forEach((k, i) => {
      const d = s[k] - this.mean[i];
      this.mean[i] += d / this.n;
      this.m2[i] += d * (s[k] - this.mean[i]);
    });
  }

  /** Nombre de mesures du repos. */
  get restCount(): number {
    return this.n;
  }

  /** Bruit du repos sur un axe : son écart type. */
  noise(axis: HeadUpMove['axis']): number {
    const i = AXES.indexOf(axis);
    return this.n ? Math.sqrt(this.m2[i] / this.n) : 0;
  }

  /** Mesure pendant la question : écart au repos, gardé s'il est tenu HEADUP_HOLD mesures dans le même sens. */
  move(s: ImuSample): void {
    if (!usable(s) || !this.n) return;
    AXES.forEach((k, i) => {
      const last = this.recent[i];
      last.push(s[k] - this.mean[i]);
      if (last.length > HEADUP_HOLD) last.shift();
      if (last.length < HEADUP_HOLD) return;
      const sign = Math.sign(last[0]);
      if (!sign || last.some((d) => Math.sign(d) !== sign)) return;
      const held = sign * Math.min(...last.map(Math.abs));
      if (Math.abs(held) > Math.abs(this.peak[i])) this.peak[i] = held;
    });
  }

  /** Le mouvement appris, ou null : repos trop court, aucun écart tenu, ou changement pas assez net. */
  result(): HeadUpMove | null {
    if (this.n < HEADUP_REST_MIN) return null;
    let best = -1;
    AXES.forEach((_, i) => {
      if (Math.abs(this.peak[i]) > (best < 0 ? 0 : Math.abs(this.peak[best]))) best = i;
    });
    if (best < 0) return null;
    const axis = AXES[best];
    const delta = Math.abs(this.peak[best]);
    if (delta < HEADUP_NOISE_FACTOR * this.noise(axis)) return null;
    return { axis, sign: this.peak[best] > 0 ? 1 : -1, delta };
  }
}
