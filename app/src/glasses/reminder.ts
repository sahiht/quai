/**
 * 1.3.0 (PRD-1.3.0 § 6.2, § 6.4) : rappel des messages importants du guidage, « vu » par le capteur de mouvement des
 * lunettes, et ce que le guidage note dans le journal de trajet. Logique pure : l'horloge, les minuteries, le capteur,
 * le renvoi de la page et le journal sont donnés par le contrôleur (et par les tests).
 *
 * Rappel (§ 6.2) : un message important (leave, board, platform, alight, replan, passed) affiché, ni effacé d'un toucher
 * ni vu au bout de 45 s, est renvoyé en page entière ; 2 rappels au plus, 45 s d'écart, tant que le moment dure. Un
 * toucher, un nouveau moment ou la fin du moment arrêtent les rappels. Seulement si le test de l'écran a dit « visible »
 * ou n'a pas été fait (Settings.display.alert) ; headUp ou dashboard : aucun rappel (il ne serait pas vu), ni capteur.
 *
 * « Vu » : si le mouvement « lever la tête » est appris (Settings.display.headUp), le capteur est ouvert (une mesure
 * toutes les 200 ms) seulement pendant qu'un message important attend d'être vu, c'est-à-dire pendant les 45 s qui
 * suivent chaque envoi (premier affichage, puis chaque rappel). Référence : la médiane des mesures des 0,4 premières
 * secondes ; un écart de plus de 60 % de l'écart appris, sur l'axe appris et dans son sens, tenu 0,6 s : vu. Le capteur
 * est fermé dès que c'est vu, touché, fini, remplacé, en arrière-plan, lunettes ôtées, à la fin du guidage : toujours.
 * Les mesures ne sont jamais gardées (seule la référence, un nombre, le temps de l'attente) ni écrites nulle part.
 */
import type { Journey, NameLang, Settings } from '../core/api';
import type { GuideMemory, GuideState, Moment } from '../core/guide-types';
import type { JournalEvent, JournalKind, TripJournal } from '../core/journal-types';
import { displayName } from '../core/util';
import { checkLines } from './guide-views';

/** Messages importants : ceux qui demandent d'agir (PRD-1.3.0 § 6.2). */
export const IMPORTANT: ReadonlySet<Moment['kind']> = new Set<Moment['kind']>(['leave', 'board', 'platform', 'alight', 'replan', 'passed']);

export const REMIND = {
  /** attente avant un rappel, et entre deux rappels */
  everyMs: 45_000,
  /** rappels au plus (3 envois en tout) */
  max: 2,
  /** une mesure du capteur toutes les 200 ms */
  imuPaceMs: 200,
  /** référence : mesures des 0,4 premières secondes */
  restMs: 400,
  /** part de l'écart appris qui compte comme « tête levée » */
  ratio: 0.6,
  /** tenue 0,6 s */
  holdMs: 600,
} as const;

/** Mouvement « lever la tête » appris pendant le test de l'écran (§ 6.1). */
export type HeadUp = NonNullable<Settings['display']['headUp']>;

/** Le moment affiché sur les lunettes (sorte et identifiant stable). */
export interface ShownMoment {
  kind: Moment['kind'];
  id: string;
}

/** Une mesure du capteur (signal `imu` de glasses/gestures.ts). */
export interface ImuSample {
  x: number;
  y: number;
  z: number;
  at: number;
}

/** Mouvement appris utilisable : un axe, un sens, un écart non nul. */
export function validHeadUp(h: unknown): h is HeadUp {
  if (!h || typeof h !== 'object') return false;
  const x = h as Partial<HeadUp>;
  return (x.axis === 'x' || x.axis === 'y' || x.axis === 'z') && (x.sign === 1 || x.sign === -1) && typeof x.delta === 'number' && Number.isFinite(x.delta) && x.delta !== 0;
}

/**
 * Ce que permet le résultat du test de l'écran : rappels si « visible » ou pas encore testé ; capteur seulement avec les
 * rappels (il sert à les éviter) et un mouvement appris.
 */
export function remindPlan(display: Pick<Settings['display'], 'alert' | 'headUp'>): { remind: boolean; headUp: HeadUp | null } {
  const remind = (display.alert ?? 'visible') === 'visible';
  return { remind, headUp: remind && validHeadUp(display.headUp) ? display.headUp : null };
}

export function median(xs: readonly number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/**
 * Tête levée, d'après les mesures d'un capteur tout juste ouvert : référence = médiane des mesures des 0,4 premières
 * secondes (oubliées dès qu'elle est calculée), puis vrai quand l'écart sur l'axe appris dépasse 60 % de l'écart appris,
 * dans son sens, sans interruption depuis 0,6 s. Les instants sont ceux des mesures (`at`, en ms).
 */
export class HeadUpWatch {
  private t0: number | null = null;
  private rest: number[] | null = [];
  private base: number | null = null;
  private since: number | null = null;

  constructor(private readonly h: HeadUp) {}

  feed(s: ImuSample): boolean {
    const v = s[this.h.axis];
    const at = s.at;
    if (!Number.isFinite(v) || !Number.isFinite(at)) return false;
    if (this.t0 === null) this.t0 = at;
    if (this.base === null) {
      if (at - this.t0 <= REMIND.restMs) {
        this.rest?.push(v);
        return false;
      }
      this.base = median(this.rest ?? []) ?? v;
      this.rest = null;
    }
    const lifted = (v - this.base) * this.h.sign > REMIND.ratio * Math.abs(this.h.delta);
    if (!lifted) {
      this.since = null;
      return false;
    }
    if (this.since === null) this.since = at;
    return at - this.since >= REMIND.holdMs;
  }
}

/** Ce que le rappel signale au contrôleur (journal, lignes du mode test). */
export type ReminderNote = { k: 'remind'; m: ShownMoment; n: number } | { k: 'seen'; m: ShownMoment } | { k: 'imu'; on: boolean };

export interface ReminderDeps {
  /** Minuterie (délai en ms de l'horloge du guidage) ; renvoie l'annulation. */
  later(fn: () => void, ms: number): () => void;
  /** Temps réel (ms) pour une mesure du capteur qui n'a pas d'instant lisible. */
  now?(): number;
  /** Réglages lus à chaque nouveau message : résultat du test de l'écran, mouvement appris. */
  display(): Pick<Settings['display'], 'alert' | 'headUp'>;
  /**
   * Capteur de mouvement des lunettes (GlassesPort.imu) ; absent, ou null rendu : pas de capteur sur cet hôte, rappels à
   * l'heure seulement.
   */
  imu?(on: boolean, paceMs?: number): Promise<boolean> | null;
  /** Renvoie la page entière du moment (rappel n° `n`) ; faux : il n'est plus à l'écran (les rappels s'arrêtent). */
  resend(m: ShownMoment, n: number): boolean;
  note?(e: ReminderNote): void;
}

interface Wait {
  m: ShownMoment;
  /** rappels déjà envoyés */
  n: number;
  cancel: (() => void) | null;
  headUp: HeadUp | null;
  watch: HeadUpWatch | null;
  /** premier plan quitté, lunettes ôtées : rien n'est envoyé, capteur fermé ; reprend au prochain affichage */
  suspended: boolean;
}

/**
 * Rappel des messages importants (§ 6.2). Le contrôleur dit ce qui est affiché après chaque rendu (`shown`), un toucher
 * (`touch`), le premier plan quitté ou les lunettes ôtées (`suspend`), la fin du guidage (`end`), et passe les mesures
 * du capteur (`sample`). Un moment a au plus une attente : finie (vu, touché, rappels faits, remplacé), elle ne
 * recommence pas pour lui.
 */
export class MomentReminder {
  private wait: Wait | null = null;
  private done = new Set<string>();
  /** capteur demandé (ouvert ou en cours d'ouverture) ; chaque ouverture demandée est suivie d'une fermeture */
  private imuOn = false;
  private imuGen = 0;

  constructor(private readonly deps: ReminderDeps) {}

  /** Moment en attente d'être vu (tests, mode test). */
  get waiting(): (ShownMoment & { n: number; suspended: boolean; imu: boolean }) | null {
    const w = this.wait;
    return w ? { ...w.m, n: w.n, suspended: w.suspended, imu: this.imuOn } : null;
  }

  /** Après chaque rendu des lunettes : le moment affiché sur l'écran du guidage (null : aucun, ou un autre écran). */
  shown(m: ShownMoment | null): void {
    const w = this.wait;
    if (w && m && m.id === w.m.id) {
      if (w.suspended) {
        w.suspended = false;
        this.arm(w);
      }
      return;
    }
    if (w) this.finish();
    if (!m || !IMPORTANT.has(m.kind) || this.done.has(m.id)) return;
    const plan = remindPlan(this.deps.display());
    if (!plan.remind) {
      this.done.add(m.id);
      return;
    }
    const next: Wait = { m: { kind: m.kind, id: m.id }, n: 0, cancel: null, headUp: plan.headUp, watch: null, suspended: false };
    this.wait = next;
    this.arm(next);
  }

  /** Un toucher sur les lunettes pendant l'attente : plus de rappel pour ce moment. */
  touch(): void {
    if (this.wait) this.finish();
  }

  /** Premier plan quitté, lunettes ôtées ou déconnectées : rien ne s'envoie, capteur fermé, jusqu'au prochain affichage. */
  suspend(): void {
    const w = this.wait;
    if (!w || w.suspended) return;
    w.suspended = true;
    w.cancel?.();
    w.cancel = null;
    this.closeImu();
  }

  /** Fin du guidage, nouveau guidage, arrêt du contrôleur : tout est oublié, capteur fermé. */
  end(): void {
    if (this.wait) this.finish();
    this.done.clear();
    this.closeImu();
  }

  /** Une mesure du capteur ; ignorée hors de l'attente (le test de l'écran a les siennes). */
  sample(s: ImuSample): void {
    const w = this.wait;
    if (!w || w.suspended || !w.watch || !this.imuOn) return;
    const at = Number.isFinite(s.at) ? s.at : this.deps.now?.();
    if (at === undefined || !w.watch.feed(at === s.at ? s : { ...s, at })) return;
    this.deps.note?.({ k: 'seen', m: w.m });
    this.finish();
  }

  /** Prochain rappel dans 45 s ; capteur ouvert si le mouvement est appris. */
  private arm(w: Wait): void {
    w.cancel?.();
    w.cancel = this.deps.later(() => this.fire(), REMIND.everyMs);
    if (w.headUp) this.openImu(w, w.headUp);
  }

  private fire(): void {
    const w = this.wait;
    if (!w || w.suspended) return;
    w.cancel = null;
    // 45 s après le dernier rappel : l'attente est finie ; test de l'écran refait entre-temps (headUp, dashboard) : plus
    // de rappel
    if (w.n >= REMIND.max || !remindPlan(this.deps.display()).remind) {
      this.finish();
      return;
    }
    w.n += 1;
    if (!this.deps.resend(w.m, w.n)) {
      this.finish();
      return;
    }
    this.deps.note?.({ k: 'remind', m: w.m, n: w.n });
    // le rendu demandé par resend peut avoir déjà mis fin à l'attente (moment changé entre-temps)
    if (this.wait === w) w.cancel = this.deps.later(() => this.fire(), REMIND.everyMs);
  }

  private finish(): void {
    const w = this.wait;
    if (!w) return;
    w.cancel?.();
    w.cancel = null;
    this.wait = null;
    this.done.add(w.m.id);
    this.closeImu();
  }

  private openImu(w: Wait, h: HeadUp): void {
    const imu = this.deps.imu;
    if (!imu || this.imuOn) return;
    let req: Promise<boolean> | null;
    try {
      req = imu(true, REMIND.imuPaceMs);
    } catch {
      req = Promise.resolve(false);
    }
    if (req === null) return;
    this.imuOn = true;
    const gen = ++this.imuGen;
    w.watch = new HeadUpWatch(h);
    this.deps.note?.({ k: 'imu', on: true });
    // refusé (faux) ou en échec : rappels à l'heure seulement ; la fermeture suivra quand même
    void Promise.resolve(req).then(
      (ok) => {
        if (!ok && gen === this.imuGen && this.wait === w) w.watch = null;
      },
      () => {
        if (gen === this.imuGen && this.wait === w) w.watch = null;
      },
    );
  }

  private closeImu(): void {
    if (!this.imuOn) return;
    this.imuOn = false;
    this.imuGen++;
    if (this.wait) this.wait.watch = null;
    this.deps.note?.({ k: 'imu', on: false });
    try {
      void Promise.resolve(this.deps.imu?.(false)).catch(() => undefined);
    } catch {
      /* hôte sans capteur : rien à fermer */
    }
  }
}

/* ------------------------------ Journal du guidage (§ 6.4) ------------------------------ */

/** Résumé des positions toutes les 5 min. */
export const POSITIONS_MS = 5 * 60_000;
/** Titre du journal d'un trajet vers une adresse : jamais d'adresse dans le journal. */
export const ADDRESS_TITLE = 'Vers une adresse';

type Details = Record<string, string | number | boolean>;

/** Clés jamais écrites (le journal les refuse aussi) : aucune coordonnée, aucune adresse. */
const FORBIDDEN = new Set(['lat', 'lon', 'lng', 'latitude', 'longitude', 'address', 'coords']);

function clean(d: Record<string, unknown>): Details {
  const out: Details = {};
  for (const [k, v] of Object.entries(d)) {
    if (FORBIDDEN.has(k.toLowerCase())) continue;
    if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
  }
  return out;
}

/**
 * Positions d'une fenêtre [from, to] : nombre, précision médiane (m), plus long trou (s, bords de la fenêtre compris).
 * Seuls des instants et des précisions : jamais de coordonnées.
 */
export function positionsSummary(ats: readonly number[], accs: readonly number[], from: number, to: number): { n: number; acc?: number; gap: number } {
  const ts = ats
    .filter((t) => Number.isFinite(t))
    .map((t) => Math.min(Math.max(t, from), to))
    .sort((a, b) => a - b);
  let gap = 0;
  let prev = from;
  for (const t of [...ts, to]) {
    gap = Math.max(gap, t - prev);
    prev = t;
  }
  const out: { n: number; acc?: number; gap: number } = { n: ats.length, gap: Math.round(gap / 1000) };
  const acc = median(accs.filter((a) => Number.isFinite(a) && a >= 0));
  if (acc !== null) out.acc = Math.round(acc);
  return out;
}

/** Titre du journal : celui de l'écran, sauf un trajet vers une adresse (le titre la contiendrait). */
export function journalTitle(title: string, to?: { type: string; label?: string }): string {
  if (to?.type !== 'address') return title;
  const label = (to.label ?? '').trim();
  const short = label.split(',')[0].trim();
  return !label || title.includes(short) || title.includes(label) ? ADDRESS_TITLE : title;
}

/**
 * Ce qu'un guidage note dans le journal de trajet (§ 6.4), sans jamais de coordonnées ni d'adresse : des sortes
 * d'événements (JournalKind), des heures, des noms d'arrêts et de gares publics, des nombres. Une erreur du journal ne
 * gêne jamais le guidage.
 */
export class GuideTrail {
  private win: { from: number; ats: number[]; accs: number[] };
  private shownIds = new Set<string>();
  private passedIds = new Set<string>();
  private checkText = '';
  private arrived = false;
  private batteryNoted = false;
  private closed = false;

  constructor(
    private readonly journal: TripJournal,
    readonly id: string,
    private readonly now: () => number,
  ) {
    this.win = { from: now(), ats: [], accs: [] };
  }

  /** Nouveau trajet guidé : begin, puis l'événement `start` (titre, genre). */
  static begin(journal: TripJournal, meta: { title: string; kind: 'trip' | 'ride' }, now: () => number): GuideTrail | null {
    try {
      const id = journal.begin({ title: meta.title, kind: meta.kind, at: now() });
      if (!id) return null;
      const t = new GuideTrail(journal, id, now);
      t.add('start', { title: meta.title, kind: meta.kind });
      return t;
    } catch (e) {
      console.warn('[Quai] journal du trajet', e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  get ended(): boolean {
    return this.closed;
  }

  add(k: JournalKind, d?: Record<string, unknown>): void {
    if (this.closed) return;
    const e: JournalEvent = { t: this.now(), k };
    if (d) {
      const c = clean(d);
      if (Object.keys(c).length) e.d = c;
    }
    try {
      this.journal.add(this.id, e);
    } catch (err) {
      console.warn('[Quai] journal du trajet', err instanceof Error ? err.message : String(err));
    }
  }

  /** Batterie des lunettes : au départ, ou la première connue en route. */
  battery(level: number | undefined): void {
    if (this.batteryNoted || level === undefined || !Number.isFinite(level)) return;
    this.batteryNoted = true;
    this.add('battery', { level: Math.round(level) });
  }

  /** Une position reçue : seulement son instant et sa précision, pour le résumé. */
  fix(at: number, accuracy?: number): void {
    this.win.ats.push(at);
    if (accuracy !== undefined && Number.isFinite(accuracy)) this.win.accs.push(accuracy);
  }

  /** Résumé des positions toutes les 5 min (`force` : fin du guidage, fenêtre en cours si elle compte). */
  positions(force = false): void {
    const now = this.now();
    const w = this.win;
    const span = now - w.from;
    if (force ? !w.ats.length && span < 60_000 : span < POSITIONS_MS) return;
    this.add('positions', positionsSummary(w.ats, w.accs, w.from, now));
    this.win = { from: now, ats: [], accs: [] };
  }

  /** Moment affiché sur les lunettes : noté au premier affichage. */
  shown(m: Pick<Moment, 'kind' | 'id'> | null): void {
    if (!m || this.shownIds.has(m.id)) return;
    this.shownIds.add(m.id);
    this.add('moment', { m: m.kind, id: m.id });
  }

  /**
   * Après chaque calcul du moteur : montée et descente constatées (mémoire du moteur), arrêt dépassé, arrivée, problèmes
   * de la vérification (texte de checkLines, séparés par « ; »), résumé des positions s'il est dû.
   */
  step(st: GuideState, before: GuideMemory, after: GuideMemory, j: Journey, lang: NameLang): void {
    const b = after.boarded;
    if (b && (b.leg !== before.boarded?.leg || b.at !== before.boarded?.at)) {
      const l = j.legs[b.leg];
      this.add('boarded', l?.kind === 'ride' ? { line: l.line ?? '', ...(l.mode ? { mode: l.mode } : {}) } : {});
    }
    const a = after.alighted;
    if (a && (a.leg !== before.alighted?.leg || a.at !== before.alighted?.at)) {
      const l = j.legs[a.leg];
      this.add('alighted', l?.kind === 'ride' ? { stop: displayName(l.to.name, lang) } : {});
    }
    const m = st.moment;
    if (m?.kind === 'passed' && !this.passedIds.has(m.id)) {
      this.passedIds.add(m.id);
      this.add('passed', { stop: displayName(m.passed, lang) });
    }
    if ((st.phase.kind === 'arrived' || m?.kind === 'arrived') && !this.arrived) {
      this.arrived = true;
      this.add('arrived');
    }
    const text = st.issues?.length ? checkLines(st.issues).join(' ; ') : '';
    if (text !== this.checkText) {
      this.checkText = text;
      if (text) this.add('check', { issues: text });
    }
    this.positions();
  }

  /** Fin du guidage : dernier résumé des positions, événement `end`, puis end du journal. Une seule fois. */
  end(reason: 'done' | 'stopped' | 'ended' | 'replaced'): void {
    if (this.closed) return;
    this.positions(true);
    this.add('end', { end: reason });
    this.closed = true;
    try {
      this.journal.end(this.id, reason, this.now());
    } catch (e) {
      console.warn('[Quai] journal du trajet', e instanceof Error ? e.message : String(e));
    }
  }
}
