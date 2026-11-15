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
 * suivent chaque envoi (premier affichage, puis chaque rappel). Contrôle technique : la référence est la position de
 * repos apprise pendant le test (headUp.rest), pas la tête au moment du message (redresser une tête baissée comptait
 * comme vu) : au-delà de repos + 60 % de l'écart appris, sur l'axe appris et dans son sens, tenu 0,6 s : vu. Un
 * mouvement sans position de repos (test fait avant) n'est pas utilisé : rappels à l'heure. Le capteur
 * est fermé dès que c'est vu, touché, fini, remplacé, en arrière-plan, lunettes ôtées, à la fin du guidage : toujours.
 * Le rappel ne referme que le capteur qu'il a ouvert et n'envoie rien au capteur hors de cette attente (un seul capteur,
 * la dernière demande gagne : le test de l'écran a le sien, jamais pendant un guidage). Après une reconnexion des
 * lunettes, la page reconstruite rouvre le capteur si le message attend encore. Les mesures ne sont jamais gardées ni
 * écrites nulle part. Quai Web : aucun rappel (le contrôleur ne lui signale aucun message).
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
  /** part de l'écart appris, au-delà de la position de repos, qui compte comme « tête levée » */
  ratio: 0.6,
  /** tenue 0,6 s */
  holdMs: 600,
} as const;

/** Mouvement « lever la tête » appris pendant le test de l'écran (§ 6.1). */
export type HeadUp = NonNullable<Settings['display']['headUp']>;
/** Mouvement utilisable pour le « vu » : avec sa position de repos (contrôle technique). */
export type HeadUpRest = HeadUp & { rest: number };

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

/**
 * Mouvement appris utilisable : un axe, un sens, un écart non nul, et (contrôle technique) la position de repos sur cet
 * axe ; sans elle (test fait avant), il n'est pas utilisé.
 */
export function validHeadUp(h: unknown): h is HeadUpRest {
  if (!h || typeof h !== 'object') return false;
  const x = h as Partial<HeadUp>;
  return (
    (x.axis === 'x' || x.axis === 'y' || x.axis === 'z') &&
    (x.sign === 1 || x.sign === -1) &&
    typeof x.delta === 'number' &&
    Number.isFinite(x.delta) &&
    x.delta !== 0 &&
    typeof x.rest === 'number' &&
    Number.isFinite(x.rest)
  );
}

/**
 * Ce que permet le résultat du test de l'écran : rappels si « visible » ou pas encore testé ; capteur seulement avec les
 * rappels (il sert à les éviter) et un mouvement appris avec sa position de repos.
 */
export function remindPlan(display: Pick<Settings['display'], 'alert' | 'headUp'>): { remind: boolean; headUp: HeadUpRest | null } {
  const remind = (display.alert ?? 'visible') === 'visible';
  const h = display.headUp;
  return { remind, headUp: remind && validHeadUp(h) ? h : null };
}

export function median(xs: readonly number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/**
 * Tête levée : vrai quand la mesure sur l'axe appris va au-delà de la position de repos apprise (headUp.rest) plus 60 %
 * de l'écart appris, dans son sens, sans interruption depuis 0,6 s. Contrôle technique : la référence n'est plus la tête
 * au moment du message (une tête baissée vers le téléphone qui se redressait comptait comme vue). Les instants sont ceux
 * des mesures (`at`, en ms) ; aucune mesure n'est gardée.
 */
export class HeadUpWatch {
  private since: number | null = null;

  constructor(private readonly h: HeadUpRest) {}

  feed(s: ImuSample): boolean {
    const v = s[this.h.axis];
    const at = s.at;
    if (!Number.isFinite(v) || !Number.isFinite(at)) return false;
    const lifted = (v - this.h.rest) * this.h.sign > REMIND.ratio * Math.abs(this.h.delta);
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

/**
 * Contrôle technique : état du rappel d'un moment, gardé avec le guidage (FollowedGuide.remind, dans quai.trip) et repris
 * à la réouverture de Quai (WebView relancée pendant un guidage) : rappels déjà faits (`n`) ; attente finie (`done` : vu,
 * touché, rappels épuisés, remplacé par un autre moment, ou pas de rappel pour ce message).
 */
export interface RemindMemo {
  id: string;
  n: number;
  done?: true;
}

/** Moments gardés au plus (les plus récents). */
export const REMIND_MEMO_MAX = 12;

/** Lecture défensive (quai.trip) : identifiant de 80 caractères au plus, rappels de 0 à 2, 12 moments au plus. */
export function readRemindMemo(x: unknown): RemindMemo[] {
  if (!Array.isArray(x)) return [];
  const out: RemindMemo[] = [];
  for (const e of x) {
    if (!e || typeof e !== 'object') continue;
    const { id, n, done } = e as Partial<RemindMemo>;
    if (typeof id !== 'string' || !id || id.length > 80 || out.some((m) => m.id === id)) continue;
    const count = typeof n === 'number' && Number.isFinite(n) ? Math.min(REMIND.max, Math.max(0, Math.round(n))) : 0;
    out.push(done === true ? { id, n: count, done: true } : { id, n: count });
  }
  return out.slice(-REMIND_MEMO_MAX);
}

export interface ReminderDeps {
  /** Minuterie (délai en ms de l'horloge du guidage) ; renvoie l'annulation. */
  later(fn: () => void, ms: number): () => void;
  /** Horloge de l'appli (celle des instants `at` des mesures, accélérée en mode test), pour une mesure sans instant lisible. */
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
  /**
   * Contrôle technique : l'état des rappels a changé (rappel fait, attente finie) : à garder avec le guidage (quai.trip),
   * pour le reprendre à la réouverture (`resume`).
   */
  keep?(memo: RemindMemo[]): void;
}

interface Wait {
  m: ShownMoment;
  /** rappels déjà envoyés */
  n: number;
  cancel: (() => void) | null;
  headUp: HeadUpRest | null;
  watch: HeadUpWatch | null;
  /** premier plan quitté, lunettes ôtées : rien n'est envoyé, capteur fermé ; reprend au prochain affichage */
  suspended: boolean;
}

/**
 * Rappel des messages importants (§ 6.2). Le contrôleur dit ce qui est affiché après chaque rendu (`shown`), un toucher
 * (`touch`), le premier plan quitté ou les lunettes ôtées (`suspend`), la fin du guidage (`end`), et passe les mesures
 * du capteur (`sample`). Un moment a au plus une attente : finie (vu, touché, rappels faits, remplacé), elle ne
 * recommence pas pour lui. Contrôle technique : cet état (rappels faits, attente finie) est donné au contrôleur à chaque
 * changement (`keep`), gardé avec le guidage, et repris à la réouverture (`resume`) : rien n'est rappelé de nouveau.
 */
export class MomentReminder {
  private wait: Wait | null = null;
  /** Par moment (le plus récent en dernier) : rappels faits, attente finie. */
  private memo = new Map<string, { n: number; done: boolean }>();
  /**
   * Capteur ouvert par ce rappel (ouverture demandée, acceptée ou non). Lui seul est refermé par lui, une fois : hors de
   * l'attente d'un message important, le rappel n'envoie rien au capteur (il n'y a qu'un capteur, la dernière demande
   * gagne : le test de l'écran a le sien, jamais pendant un guidage).
   */
  private imuMine = false;
  private imuGen = 0;

  constructor(private readonly deps: ReminderDeps) {}

  /** Moment en attente d'être vu (tests, mode test). */
  get waiting(): (ShownMoment & { n: number; suspended: boolean; imu: boolean }) | null {
    const w = this.wait;
    return w ? { ...w.m, n: w.n, suspended: w.suspended, imu: this.imuMine } : null;
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
    if (!m || !IMPORTANT.has(m.kind) || this.memo.get(m.id)?.done) return;
    const plan = remindPlan(this.deps.display());
    if (!plan.remind) {
      this.mark(m.id, { done: true });
      return;
    }
    // repris après une réouverture : les rappels déjà faits comptent (seuls les restants partent)
    const next: Wait = { m: { kind: m.kind, id: m.id }, n: this.memo.get(m.id)?.n ?? 0, cancel: null, headUp: plan.headUp, watch: null, suspended: false };
    this.wait = next;
    this.arm(next);
  }

  /**
   * Contrôle technique : l'état gardé avec le guidage (quai.trip), à la réouverture de Quai ou à la reprise d'un état
   * d'arrière-plan, avant le premier affichage : un moment fini ne recommence pas, un moment déjà rappelé garde ses
   * rappels faits. Fusionné avec ce qui est déjà connu (le plus avancé l'emporte).
   */
  resume(memo: readonly RemindMemo[] | undefined): void {
    for (const e of readRemindMemo(memo)) {
      const had = this.memo.get(e.id);
      this.memo.set(e.id, { n: Math.max(had?.n ?? 0, e.n), done: !!had?.done || e.done === true });
    }
    this.trim();
    const w = this.wait;
    const now = w ? this.memo.get(w.m.id) : undefined;
    if (!w || !now) return;
    if (now.done) this.finish();
    else w.n = Math.max(w.n, now.n);
  }

  /** État de chaque moment (les plus récents), tel qu'il est gardé avec le guidage. */
  memory(): RemindMemo[] {
    return [...this.memo].map(([id, e]) => (e.done ? { id, n: e.n, done: true as const } : { id, n: e.n }));
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

  /**
   * Fin du guidage, nouveau guidage, arrêt du contrôleur : tout est oublié, capteur fermé (l'état gardé avec un guidage
   * qui continue reste dans quai.trip : rien n'est donné au contrôleur ici).
   */
  end(): void {
    const w = this.wait;
    if (w) {
      w.cancel?.();
      w.cancel = null;
      this.wait = null;
    }
    this.memo.clear();
    this.closeImu();
  }

  /** Une mesure du capteur ; ignorée hors de l'attente (le test de l'écran a les siennes). */
  sample(s: ImuSample): void {
    const w = this.wait;
    if (!w || w.suspended || !w.watch || !this.imuMine) return;
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
    this.mark(w.m.id, { n: w.n });
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
    this.closeImu();
    this.mark(w.m.id, { n: w.n, done: true });
  }

  /** Nouvel état d'un moment (il devient le plus récent), puis donné au contrôleur pour être gardé. */
  private mark(id: string, change: { n?: number; done?: boolean }): void {
    const had = this.memo.get(id);
    this.memo.delete(id);
    this.memo.set(id, { n: change.n ?? had?.n ?? 0, done: change.done ?? had?.done ?? false });
    this.trim();
    this.deps.keep?.(this.memory());
  }

  /** Les REMIND_MEMO_MAX moments les plus récents. */
  private trim(): void {
    for (const id of this.memo.keys()) {
      if (this.memo.size <= REMIND_MEMO_MAX) break;
      this.memo.delete(id);
    }
  }

  private openImu(w: Wait, h: HeadUpRest): void {
    const imu = this.deps.imu;
    if (!imu || this.imuMine) return;
    let req: Promise<boolean> | null;
    try {
      req = imu(true, REMIND.imuPaceMs);
    } catch {
      req = Promise.resolve(false);
    }
    if (req === null) return;
    this.imuMine = true;
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
    if (!this.imuMine) return;
    this.imuMine = false;
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
  /** sortes des problèmes de la vérification au dernier calcul (« battery+positionLost ») */
  private checkKinds = '';
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
    // contrôle technique : noté quand les problèmes changent (leurs sortes), pas à chaque minute de « Position perdue
    // depuis 3 min, 4 min… » ni à chaque pour cent de batterie (une ligne par minute pendant une heure sans position)
    const kinds = st.issues?.length ? st.issues.map((i) => i.kind).join('+') : '';
    if (kinds !== this.checkKinds) {
      this.checkKinds = kinds;
      if (st.issues?.length) this.add('check', { issues: checkLines(st.issues).join(' ; ') });
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
