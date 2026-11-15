/**
 * 1.3.0 (PRD-1.3.0 § 6.1) : mouvement « lever la tête », appris pendant le test de l'écran des lunettes. Logique pure :
 * ni minuterie, ni accès au matériel ; le contrôleur donne les mesures du capteur de mouvement (signal `imu`, datées sur
 * l'horloge de l'appli) et l'heure de la réponse.
 *
 * On ne sait pas si x, y, z sont des angles, des accélérations ou des vitesses ; un mauvais sens appris ferait compter
 * comme « vu » le fait de baisser la tête vers le téléphone (rappels supprimés à tort). L'apprentissage est donc sûr :
 *
 * - Pendant l'attente (« ne touche à rien ») : la position de repos, moyenne et bruit (écart type) de chaque axe.
 * - À la réponse (« Le test de Quai », « Le Dashboard ») : la posture « téléphone », médiane des mesures des 0,5 s
 *   d'avant (la personne regarde son téléphone pour toucher le bouton). Axe retenu : celui où elle s'écarte le plus du
 *   repos, d'au moins trois fois le bruit ; sens « lever la tête » : l'opposé de la posture téléphone.
 * - Écart appris : le plus grand écart à ce repos, dans ce sens-là, pendant la question, sans la dernière seconde avant
 *   la réponse ; tenu `HEADUP_HOLD` mesures de suite (un pic isolé ne compte pas), et lui aussi d'au moins trois fois le
 *   bruit. Sinon rien n'est appris (des vitesses, qui reviennent à zéro, n'ont pas de posture téléphone) : `headUp`
 *   reste tel quel, les rappels se font à l'heure seulement.
 *
 * Confidentialité (PRD-1.3.0 § 10) : aucune mesure n'est gardée, seulement des sommes pour le repos, la dernière seconde
 * de mesures (une dizaine) et le plus grand écart tenu de chaque sens ; seul le mouvement appris (un axe, un sens, un
 * écart) est enregistré dans les réglages.
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

/** Une mesure datée (horloge de l'appli, ms). */
export interface ImuMeasure extends ImuSample {
  at: number;
}

const AXES = ['x', 'y', 'z'] as const;

/** Changement net : au moins trois fois le bruit du repos (PRD-1.3.0 § 6.1). */
export const HEADUP_NOISE_FACTOR = 3;
/** Écart tenu : 3 mesures de suite dans le même sens (0,3 s à une mesure toutes les 100 ms). */
export const HEADUP_HOLD = 3;
/** Repos connu : 10 mesures au moins (1 s à une mesure toutes les 100 ms). */
export const HEADUP_REST_MIN = 10;
/** Posture « téléphone » : médiane des mesures des 0,5 s avant la réponse, 3 mesures au moins. */
export const HEADUP_PHONE_MS = 500;
export const HEADUP_PHONE_MIN = 3;
/** La dernière seconde avant la réponse ne compte pas pour l'écart (la tête descend vers le téléphone). */
export const HEADUP_LAST_MS = 1_000;

const usable = (s: ImuSample): boolean => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z);

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Apprentissage du mouvement « lever la tête » : `rest` pendant l'attente, `move` pendant la question, puis `result`. */
export class HeadUpLearner {
  /** Repos : nombre de mesures, moyenne et somme des carrés des écarts par axe (méthode de Welford). */
  private n = 0;
  private mean = [0, 0, 0];
  private m2 = [0, 0, 0];
  /** Question : la dernière seconde de mesures, pas encore comptée (elle peut précéder la réponse). */
  private last: ImuMeasure[] = [];
  /** Écarts comptés : les derniers de chaque axe (HEADUP_HOLD au plus), plus grand écart tenu vers le haut et vers le bas. */
  private recent: number[][] = [[], [], []];
  private up = [0, 0, 0];
  private down = [0, 0, 0];

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

  /** Mesure pendant la question ; celles de plus d'une seconde avant la plus récente sont comptées (hors de la fin). */
  move(s: ImuMeasure): void {
    if (!usable(s) || !Number.isFinite(s.at) || !this.n) return;
    this.last.push({ x: s.x, y: s.y, z: s.z, at: s.at });
    this.countBefore(s.at - HEADUP_LAST_MS);
  }

  /** Compte les mesures d'avant `t` : écart au repos, gardé s'il est tenu HEADUP_HOLD mesures dans le même sens. */
  private countBefore(t: number): void {
    while (this.last.length && this.last[0].at <= t) {
      const s = this.last.shift()!;
      AXES.forEach((k, i) => {
        const r = this.recent[i];
        r.push(s[k] - this.mean[i]);
        if (r.length > HEADUP_HOLD) r.shift();
        if (r.length < HEADUP_HOLD) return;
        const sign = Math.sign(r[0]);
        if (!sign || r.some((d) => Math.sign(d) !== sign)) return;
        const held = Math.min(...r.map(Math.abs));
        if (sign > 0) this.up[i] = Math.max(this.up[i], held);
        else this.down[i] = Math.max(this.down[i], held);
      });
    }
  }

  /**
   * Le mouvement appris à la réponse donnée à `answerAt`, ou null : repos trop court, pas de posture téléphone nette
   * (axe retenu), ou pas d'écart net dans le sens opposé avant la dernière seconde.
   */
  result(answerAt: number): HeadUpMove | null {
    if (this.n < HEADUP_REST_MIN || !Number.isFinite(answerAt)) return null;
    this.countBefore(answerAt - HEADUP_LAST_MS);
    const phone = this.last.filter((m) => m.at >= answerAt - HEADUP_PHONE_MS && m.at <= answerAt);
    if (phone.length < HEADUP_PHONE_MIN) return null;
    const off = AXES.map((k, i) => median(phone.map((m) => m[k])) - this.mean[i]);
    let best = 0;
    off.forEach((d, i) => {
      if (Math.abs(d) > Math.abs(off[best])) best = i;
    });
    const axis = AXES[best];
    const floor = HEADUP_NOISE_FACTOR * this.noise(axis);
    if (!(Math.abs(off[best]) > 0) || Math.abs(off[best]) < floor) return null;
    const sign = off[best] > 0 ? -1 : 1;
    const delta = sign > 0 ? this.up[best] : this.down[best];
    if (!(delta > 0) || delta < floor) return null;
    return { axis, sign, delta };
  }
}
