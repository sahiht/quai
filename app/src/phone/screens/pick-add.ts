/**
 * Ajout d'une gare, d'un arrêt ou d'une ligne (PRD-1.2.2 § 4, PRD-1.2.3 § 3 ; 1.2.6, PRD-1.2.6 § 5), sur le téléphone
 * et dans l'onglet Réglages de Quai Web. Chacun commence par « Près de toi » (calculé sur le téléphone, la position ne
 * le quitte pas) : « Ajouter » à droite, « Ajoutée ✓ » ensuite, un second toucher retire ; dessous, la recherche.
 *  - « Ajouter une gare » : les gares à moins de 2 km ; « Une autre gare » : un champ limité aux gares SNCB
 *    (core.search filtré), les plus proches d'abord ; une gare déjà choisie est signalée « Déjà dans tes gares ».
 *  - « Ajouter un arrêt » : les arrêts de bus, tram et métro les plus proches, avec leurs lignes à leur couleur ;
 *    « Un autre arrêt » : un champ limité à ces arrêts (core.search sans les gares SNCB) ; un toucher ajoute l'arrêt
 *    avec toutes ses lignes (LinePick sans `line`). ?arret={zone} (lien de « Un endroit », revue d'usage n° 3) : cet
 *    arrêt en tête.
 *  - « Ajouter une ligne » : les lignes des arrêts à 500 m (8 au plus) ; « Une autre ligne » : « Numéro de la ligne »
 *    (core.findLines : « Bus W TEC, Braine-l’Alleud ↔ Bruxelles Midi », les plus proches d'abord) ; un toucher ajoute
 *    la ligne entière, dans les deux sens (LineFollow), et confirme. ?arret={zone} : les lignes de cet arrêt en
 *    raccourcis.
 * Erreurs, limites et listes vides dites en clair ; jamais de coordonnées à l'écran.
 */
import type { AreaSummary, LatLon, LineMatch, Mode, Names, Op, SearchItem } from '../../core/api';
import { lineKey } from '../../core/linepicks';
import { displayName, distanceM, kindLabel, mainMode } from '../../core/util';
import { LIMITS } from '../../settings';
import { normalizeForSearch } from '../../../../shared/names';
import { header, type PhoneCtx } from '../app';
import { debounce, h, icon } from '../dom';
import { distanceText, lineAddedText, lineFollowedText, lineLimitText, lineMatchText, lineName, stationAddedText, stationLimitText, stopAddedText, stopLimitText, stopLinesText, T, typo } from '../text';
import { followsOf } from '../../glasses/views';
import { badgeRow, lineBadge } from '../badges';
import { isFollowed, type LineFollow } from '../../core/linerun';
import { OP_NAME } from '../../core/util';
import { messageHub } from '../ui';
import { linesAtStop, trainIcon, withLine, withStation } from './picks';

/** Gares proposées sans texte : à moins de 2 km de la position (3 × 3 tuiles autour d'elle, recherche légère). */
export const NEAR_STATIONS_M = 2000;
export const NEAR_STATIONS_MAX = 5;
const TYPE_DELAY_MS = 200;

/**
 * Proposition d'une liste : icône, nom (et en dessous son type, « tram STIB »), à droite la distance ou l'état ;
 * `verb` lu avant le nom (« Ajouter »).
 */
function option(o: { icon: HTMLSpanElement; label: string; sub?: string; meta?: string; verb?: string; extra?: HTMLElement; onPick: () => void }): HTMLLIElement {
  return h(
    'li',
    null,
    h(
      'button',
      { type: 'button', class: 'row opt', onclick: o.onPick },
      o.icon,
      h('span', { class: 'txt' }, h('span', { class: 't1' }, o.verb ? h('span', { class: 'sr-only' }, `${o.verb} `) : null, o.label), o.sub ? h('span', { class: 't2' }, o.sub) : null, o.extra ?? null),
      o.meta ? h('span', { class: 'meta' }, o.meta) : null,
    ),
  );
}

/**
 * 1.2.6 : une rangée « Près de toi » des trois ajouts (gare, arrêt, ligne) : icône ou pastille, nom,
 * détail, et à droite « Ajouter », qui devient « Ajoutée ✓ » (« Ajouté ✓ » pour un arrêt) ; toucher encore retire.
 * Contrôle qualité 1.2.6 : le bouton suit les réglages (un ajout par la recherche dessous, un retrait ailleurs) ; sinon
 * il disait « Ajouter » pour un élément déjà gardé, et le toucher le retirait.
 */
function toggleRow(o: { ctx: Pick<PhoneCtx, 'settings'>; icon: HTMLElement; t1: string; t2?: string; extra?: HTMLElement; done: string; on: () => boolean; toggle: () => Promise<void> }): HTMLLIElement {
  const btn = h('button', { type: 'button', class: 'btn btn-small' });
  // pendant l'enregistrement, les touchers sont ignorés sans griser le bouton : un bouton grisé perd le curseur
  let busy = false;
  const paintBtn = (): void => {
    const on = o.on();
    btn.className = on ? 'btn btn-small btn-on' : 'btn btn-small btn-secondary';
    btn.textContent = on ? `${o.done} ✓` : 'Ajouter';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', `${o.t1} : ${on ? `${o.done.toLowerCase()}, toucher pour retirer` : 'ajouter'}`);
  };
  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      await o.toggle();
    } finally {
      busy = false;
      btn.removeAttribute('aria-busy');
      paintBtn();
    }
  });
  paintBtn();
  const li = h('li', { class: 'near-row' }, o.icon, h('span', { class: 'txt' }, h('span', { class: 't1' }, o.t1), o.t2 ? h('span', { class: 't2' }, o.t2) : null, o.extra ?? null), btn);
  const stop = o.ctx.settings.subscribe(() => {
    if (!li.isConnected) {
      stop();
      return;
    }
    if (!busy) paintBtn();
  });
  return li;
}

/** 1.2.6 : bloc « Près de toi » (caché tant qu'il est vide) et l'intitulé de la recherche dessous. */
function nearBlock(other: string): { box: HTMLElement; list: HTMLUListElement; other: HTMLElement; show(n: number): void } {
  const list = h('ul', { class: 'list box' });
  const box = h('div', { class: 'step', hidden: true }, h('h2', { class: 'sub-head' }, 'Près de toi'), list);
  const head = h('h2', { class: 'sub-head', hidden: true }, other);
  return {
    box,
    list,
    other: head,
    show: (n) => {
      box.hidden = !n;
      head.hidden = !n;
    },
  };
}

/** Champ d'une recherche : étiquette, saisie, note sous le champ (état, erreur). */
function searchField(o: { id: string; label: string; placeholder: string; autofocus?: boolean }): { el: HTMLElement; input: HTMLInputElement; note: HTMLParagraphElement; say(text: string, error?: boolean): void } {
  const note = h('p', { class: 'field-note', id: `${o.id}-etat`, role: 'status', 'aria-live': 'polite' });
  const input = h('input', {
    id: o.id,
    class: 'input',
    type: 'search',
    placeholder: o.placeholder,
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    'aria-describedby': note.id,
    'data-autofocus': o.autofocus,
  });
  const el = h('div', { class: 'field' }, h('label', { for: o.id }, o.label), input, note);
  return {
    el,
    input,
    note,
    say(text, error = false) {
      note.textContent = typo(text);
      note.classList.toggle('err', error);
    },
  };
}

const near = (ctx: PhoneCtx): LatLon | null => {
  const f = ctx.location.last();
  return f ? { lat: f.lat, lon: f.lon } : null;
};

/** Délai d'une position demandée pour « Près de toi » quand aucune n'est encore connue (comme la recherche). */
const NEAR_FIX_MS = 6000;

/**
 * Contrôle qualité 1.2.6 : position de « Près de toi » : la dernière connue, sinon une demandée (6 s au plus) ; sans
 * elle, « Près de toi » restait vide pour toujours quand l'écran s'ouvrait avant la première position.
 */
async function nearPos(ctx: PhoneCtx): Promise<LatLon | null> {
  const f = ctx.location.last() ?? (await ctx.location.current(NEAR_FIX_MS).catch(() => null));
  return f ? { lat: f.lat, lon: f.lon } : null;
}

/* ------------------------------ Ajouter une gare ------------------------------ */

interface StationChoice { areaId: string; name: Names; lat: number; lon: number; distanceM?: number }

const ofItem = (it: SearchItem, pos: LatLon | null): StationChoice => ({ areaId: it.id, name: it.n, lat: it.lat, lon: it.lon, distanceM: pos ? distanceM(pos, it) : undefined });
const ofArea = (a: AreaSummary, d: number): StationChoice => ({ areaId: a.id, name: a.n, lat: a.lat, lon: a.lon, distanceM: d });

/**
 * Gares SNCB d'une recherche (search() filtré), dans l'ordre du cœur : gares d'abord, mot exact, puis les plus proches
 * par paliers de distance quand la position est connue.
 */
export function stationsOf(items: readonly SearchItem[], pos: LatLon | null): StationChoice[] {
  return items.filter((it) => it.op === 'sncb').map((it) => ofItem(it, pos));
}

export function addStationScreen(ctx: PhoneCtx): HTMLElement {
  const field = searchField({ id: 'gare-nom', label: T.stationField, placeholder: T.stationPlaceholder, autofocus: true });
  const list = h('ul', { class: 'list box opts', 'aria-label': T.stations, hidden: true });
  const hub = messageHub();
  const msg = hub.slot();
  const done = h('button', { type: 'button', class: 'btn btn-secondary btn-block', hidden: true, onclick: () => ctx.go('#/gares') }, T.done);
  let shown: StationChoice[] = [];
  let seq = 0;
  const nbS = nearBlock('Une autre gare');
  const nearStation = (c: StationChoice): HTMLLIElement => {
    const taken = (): boolean => ctx.settings.get().stations.some((x) => x.areaId === c.areaId);
    return toggleRow({
      ctx,
      icon: trainIcon(),
      t1: displayName(c.name, ctx.settings.get().lang),
      t2: c.distanceM !== undefined ? typo(distanceText(c.distanceM)) : undefined,
      done: 'Ajoutée',
      on: taken,
      toggle: async () => {
        hub.clear();
        if (taken()) await ctx.settings.update((x) => ({ ...x, stations: x.stations.filter((y) => y.areaId !== c.areaId) }));
        else if (withStation(ctx.settings.get(), c) === 'full') hub.say(msg, typo(stationLimitText(LIMITS.stations)), true);
        else
          await ctx.settings.update((x) => {
            const r = withStation(x, c, ctx.clock.now());
            return typeof r === 'object' ? r.settings : x;
          });
        paint();
      },
    });
  };

  const paint = (): void => {
    const s = ctx.settings.get();
    list.replaceChildren(
      ...shown.map((c) => {
        const taken = s.stations.some((x) => x.areaId === c.areaId);
        const meta = taken ? T.stationTaken : c.distanceM !== undefined ? typo(distanceText(c.distanceM)) : undefined;
        return option({ icon: icon('train'), label: displayName(c.name, s.lang), meta, verb: 'Ajouter', onPick: () => void pick(c) });
      }),
    );
    list.hidden = !shown.length;
  };

  /**
   * Sans texte : les gares les plus proches (recherche légère, sans départs). 1.2.6 : dans « Près de toi », au-dessus
   * du champ, un toucher pour les ajouter ou les retirer. Une seule demande de position, sans faire attendre le reste.
   */
  let nearTried = false;
  const fillNear = async (): Promise<void> => {
    const known = near(ctx);
    if (nbS.list.children.length || (nearTried && !known)) return;
    nearTried = true;
    try {
      const here = known ?? (await nearPos(ctx));
      if (!here || nbS.list.children.length) return;
      const around = await (await ctx.core()).nearby(here.lat, here.lon, NEAR_STATIONS_M, { light: true });
      if (nbS.list.children.length) return;
      const cs = around.filter((n) => n.area.op === 'sncb').slice(0, NEAR_STATIONS_MAX).map((n) => ofArea(n.area, n.distanceM));
      nbS.list.replaceChildren(...cs.map(nearStation));
      nbS.show(cs.length);
    } catch {
      // « Près de toi » reste caché ; la recherche dessous reste utilisable
    }
  };

  const run = async (): Promise<void> => {
    const my = ++seq;
    const q = field.input.value.trim();
    const pos = near(ctx);
    let items: StationChoice[] = [];
    let note = '';
    try {
      const core = await ctx.core();
      if (normalizeForSearch(q).replace(/ /g, '').length >= 2) {
        items = stationsOf(await core.search(q, pos ?? undefined), pos);
        if (!items.length) note = T.stationNone;
      } else void fillNear();
    } catch {
      if (my !== seq) return;
      shown = [];
      paint();
      field.say(T.searchDown, true);
      return;
    }
    if (my !== seq) return;
    shown = items;
    paint();
    field.say(note);
  };

  async function pick(c: StationChoice): Promise<void> {
    const name = displayName(c.name, ctx.settings.get().lang);
    const r = withStation(ctx.settings.get(), c, ctx.clock.now());
    if (r === 'exists') return hub.say(msg, T.stationExists);
    if (r === 'full') return hub.say(msg, typo(stationLimitText(LIMITS.stations)), true);
    await ctx.settings.update((x) => {
      const again = withStation(x, c, ctx.clock.now());
      return typeof again === 'object' ? again.settings : x;
    });
    hub.say(msg, stationAddedText(name));
    done.hidden = false;
    // Prêt pour une autre gare : le champ se vide, les gares proches reviennent (celle-ci « déjà dans tes gares »).
    field.input.value = '';
    await run();
    // le bouton touché a disparu avec la liste : le curseur va à « Terminé » (sans rouvrir le clavier)
    done.focus();
  }

  field.input.addEventListener('input', debounce(() => void run(), TYPE_DELAY_MS));
  field.input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    list.querySelector<HTMLButtonElement>('button')?.focus();
  });
  void run();
  return h('div', { class: 'screen' }, header(ctx, T.addStation, T.stationLead, { label: 'Accueil', hash: '#/' }), nbS.box, nbS.other, field.el, msg, done, list);
}

/* ------------------------------ Ajouter une ligne ou un arrêt ------------------------------ */

/** Arrêt présélectionné (?arret=…) : sa zone, et ses lignes de bus, tram et métro (« Tram 3 », « Tram 4 »). */
interface Preset { area: AreaSummary | null; lines: { line: string; mode: Mode }[] }

/** Lignes d'un arrêt, une fois chacune (linesAt donne une entrée par direction), sans les trains. */
export function linesOfStop(lines: readonly { line: string; mode: Mode }[]): { line: string; mode: Mode }[] {
  const out: { line: string; mode: Mode }[] = [];
  for (const l of lines) if (l.mode !== 'train' && !out.some((x) => lineKey(x.line) === lineKey(l.line))) out.push({ line: l.line, mode: l.mode });
  return out;
}

/** Zone et lignes de l'arrêt présélectionné ; rien de connu si le cœur ne le trouve pas. */
async function loadPreset(ctx: PhoneCtx, areaId: string): Promise<Preset> {
  try {
    const core = await ctx.core();
    const [area, lines] = await Promise.all([
      core.board(areaId, { limit: 1 }).then((b) => b.area).catch(() => null),
      core.linesAt(areaId).catch(() => []),
    ]);
    return { area, lines: linesOfStop(lines) };
  } catch {
    return { area: null, lines: [] };
  }
}

const modeIcon = (mode: Mode): HTMLSpanElement => icon(mode === 'bus' ? 'bus' : mode === 'train' ? 'train' : 'tram');

/** 1.2.6 : une ligne trouvée devient une ligne suivie, entière, dans les deux sens (variantes, terminus, couleur). */
function followOf(m: LineMatch, now: number): LineFollow {
  const f: LineFollow = { id: `f-${m.op}-${lineKey(m.line)}-${now.toString(36)}`, op: m.op as LineFollow['op'], mode: m.mode, line: m.line, routes: m.routes.slice(0, 16), ends: m.ends.slice(0, 2) };
  if (m.color) {
    f.color = m.color;
    if (m.text) f.text = m.text;
  }
  return f;
}

function linePanel(ctx: PhoneCtx, arret: string | null, presetP: Promise<Preset> | null): HTMLElement {
  const lang = () => ctx.settings.get().lang;
  let preset: Preset | null = null;
  let seq = 0;
  const hub = messageHub();
  const msg1 = hub.slot();

  /* --- 1. Numéro de la ligne --- */
  const num = searchField({ id: 'ligne-num', label: T.lineField, placeholder: T.linePlaceholder, autofocus: true });
  const quick = h('div', { class: 'quick', hidden: true });
  const found = h('ul', { class: 'list box opts', 'aria-label': T.linesFound, hidden: true });
  const step1 = h('div', { class: 'step' }, num.el, quick, found);

  /* --- 2. 1.2.6 : la ligne choisie est ajoutée entière, dans les deux sens (plus d'arrêt à choisir) --- */
  const chosen = h('p', { class: 'chosen-line' });
  const change = h('button', { type: 'button', class: 'btn-link' }, T.changeLine);
  const msg2 = hub.slot();
  const again = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, T.anotherLine);
  const done = h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => ctx.go('#/lignes') }, T.done);
  const after = h('div', { class: 'after-add', hidden: true }, again, done);
  const step2 = h('div', { class: 'step', hidden: true }, h('div', { class: 'chosen' }, chosen, change), msg2, after);

  /** Position pour trier : l'arrêt présélectionné, sinon la position du téléphone. */
  const ref = (): LatLon | null => (preset?.area ? { lat: preset.area.lat, lon: preset.area.lon } : near(ctx));

  let lastFound: LineMatch[] = [];
  const paintFound = (ms: LineMatch[]): void => {
    lastFound = ms;
    found.replaceChildren(
      ...ms.map((m) =>
        option({
          icon: lineBadge(ctx, m),
          label: lineMatchText(m, lang()),
          // comme les gares et les arrêts : une ligne déjà suivie le dit avant le toucher
          meta: followed(m) ? T.lineTaken : m.nearest ? typo(distanceText(m.nearest.distanceM)) : undefined,
          verb: 'Ajouter',
          onPick: () => void choose(m),
        }),
      ),
    );
    found.hidden = !ms.length;
  };

  const search = async (): Promise<void> => {
    const my = ++seq;
    const q = num.input.value.trim();
    if (!lineKey(q)) {
      paintFound([]);
      num.say('');
      return;
    }
    let ms: LineMatch[];
    try {
      // Jamais une ligne SNCB (bus de remplacement compris) : les réglages n'en gardent pas (LinePick, settings.ts).
      ms = (await (await ctx.core()).findLines(q, ref())).filter((m) => m.op !== 'sncb' && m.mode !== 'train');
    } catch {
      if (my !== seq) return;
      paintFound([]);
      num.say(T.searchDown, true);
      return;
    }
    if (my !== seq) return;
    paintFound(ms);
    num.say(ms.length ? '' : T.lineNone);
  };
  num.input.addEventListener('input', debounce(() => void search(), TYPE_DELAY_MS));
  num.input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    found.querySelector<HTMLButtonElement>('button')?.focus();
  });
  // « déjà dans tes lignes » suit les réglages (une ligne ajoutée ou retirée dans « Près de toi », au-dessus)
  const unwatch = ctx.settings.subscribe(() => {
    if (!found.isConnected) {
      unwatch();
      return;
    }
    if (!found.hidden && !found.contains(document.activeElement)) paintFound(lastFound);
  });

  async function choose(m: LineMatch): Promise<void> {
    hub.clear();
    nearBox.hidden = true;
    otherHead.hidden = true;
    chosen.textContent = lineMatchText(m, lang());
    step1.hidden = true;
    step2.hidden = false;
    const name = lineName(m);
    if (followed(m)) hub.say(msg2, typo(lineFollowedText(name)));
    else if ((ctx.settings.get().follows ?? []).length >= LIMITS.lines) hub.say(msg2, typo(lineLimitText(LIMITS.lines)), true);
    else {
      await ctx.settings.update((x) => ({ ...x, follows: [...(x.follows ?? []), followOf(m, ctx.clock.now())] }));
      hub.say(msg2, typo(lineAddedText(name, m.ends.map((e) => displayName(e, lang())).join(' ↔ '))));
    }
    after.hidden = false;
    again.focus();
  }

  const back = (clear: boolean): void => {
    seq++;
    hub.clear();
    step2.hidden = true;
    step1.hidden = false;
    nearBox.hidden = !nearList.children.length;
    otherHead.hidden = nearBox.hidden;
    if (clear) {
      num.input.value = '';
      paintFound([]);
      num.say('');
    }
    num.input.focus();
  };
  change.addEventListener('click', () => back(false));
  again.addEventListener('click', () => back(true));

  // Arrêt présélectionné (« Un endroit ») : son nom, ses lignes en raccourcis ; trié depuis lui.
  if (arret && presetP) {
    void presetP.then((p) => {
      preset = p;
      if (!p.lines.length) return;
      const where = p.area ? displayName(p.area.n, lang()) : '';
      quick.replaceChildren(
        h('p', { class: 'small' }, typo(stopLinesText(where))),
        h(
          'div',
          { class: 'shortcuts', role: 'group', 'aria-label': stopLinesText(where).replace(/ :$/, '') },
          p.lines.map((l) =>
            h('button', {
              type: 'button',
              class: 'shortcut',
              onclick: () => {
                num.input.value = l.line;
                void search();
              },
            }, lineName({ op: (p.area?.op ?? arret.split(':')[0]) as Op, line: l.line, mode: l.mode })),
          ),
        ),
      );
      quick.hidden = false;
    });
  }
  /* --- 1.2.6 : « Près de toi », les lignes des arrêts proches, un toucher pour les ajouter --- */
  const nearList = h('ul', { class: 'list box' });
  const nearBox = h('div', { class: 'step', hidden: true }, h('h2', { class: 'sub-head' }, 'Près de toi'), nearList);
  const otherHead = h('h2', { class: 'sub-head', hidden: true }, 'Une autre ligne');
  const followed = (m: LineMatch): boolean => followsOf(ctx.settings.get()).some((f) => isFollowed(f, m));
  const nearRow = (m: LineMatch): HTMLLIElement => {
    const s = ctx.settings.get();
    const ends = m.ends.map((e) => displayName(e, s.lang)).join(' ↔ ');
    const dist = m.nearest ? ` · ${distanceText(m.nearest.distanceM)}` : '';
    return toggleRow({
      ctx,
      icon: lineBadge(ctx, m),
      t1: typo(lineName(m)),
      t2: typo(`${OP_NAME[m.op]} · ${ends}${dist}`),
      done: 'Ajoutée',
      on: () => followed(m),
      toggle: async () => {
        if (followed(m)) {
          await ctx.settings.update((x) => ({ ...x, follows: (x.follows ?? []).filter((f) => !isFollowed(f, m)) }));
        } else {
          if ((ctx.settings.get().follows ?? []).length >= LIMITS.lines) return hub.say(msg1, typo(lineLimitText(LIMITS.lines)), true);
          hub.clear();
          await ctx.settings.update((x) => ({ ...x, follows: [...(x.follows ?? []), followOf(m, ctx.clock.now())] }));
        }
      },
    });
  };
  void nearPos(ctx)
    .then(async (pos0) => {
      if (!pos0) return;
      const ms = (await (await ctx.core()).linesNear?.(pos0, NEAR_LINES_M)) ?? [];
      if (!ms.length) return;
      nearList.replaceChildren(...ms.slice(0, NEAR_LINES_MAX).map(nearRow));
      nearBox.hidden = !step2.hidden;
      otherHead.hidden = nearBox.hidden;
    })
    .catch(() => undefined);
  return h('div', { class: 'line-add' }, h('p', { class: 'lead' }, T.lineLead), nearBox, msg1, otherHead, step1, step2);
}

/** 1.2.6 : « Près de toi » : lignes des arrêts à 500 m au plus, 8 au plus. */
const NEAR_LINES_M = 500;
const NEAR_LINES_MAX = 8;

/** Arrêts proposés sans texte : les plus proches, à moins de 800 m de la position (recherche légère). */
export const NEAR_STOPS_M = 800;
export const NEAR_STOPS_MAX = 5;

/** Arrêt de bus, tram ou métro proposé : zone, réseau, type (« tram STIB »), distance. */
interface StopChoice { areaId: string; op: Op; name: Names; lat: number; lon: number; modes: Mode[]; kind: string; distanceM?: number }

/**
 * Arrêts de bus, tram et métro d'une recherche (search() sans les gares SNCB), dans l'ordre du cœur : mot exact, puis
 * les plus proches par paliers de distance quand la position est connue.
 */
export function stopsOf(items: readonly SearchItem[], pos: LatLon | null): StopChoice[] {
  return items
    .filter((it) => it.op !== 'sncb' && !it.modes.every((m) => m === 'train'))
    .map((it) => ({ areaId: it.id, op: it.op, name: it.n, lat: it.lat, lon: it.lon, modes: it.modes, kind: it.kindLabel, distanceM: pos ? distanceM(pos, it) : undefined }));
}

const ofStopArea = (a: AreaSummary, d?: number): StopChoice => ({ areaId: a.id, op: a.op, name: a.n, lat: a.lat, lon: a.lon, modes: a.modes, kind: kindLabel(a.op, a.modes), distanceM: d });

/**
 * « Un arrêt » (PRD-1.2.3 § 3) : un champ limité aux arrêts de bus, tram et métro, le plus proche d'abord (sans texte :
 * les plus proches de la position, l'arrêt présélectionné en tête) ; un toucher ajoute l'arrêt avec toutes ses lignes
 * (LinePick sans `line` ni `mode`) et confirme ; un arrêt déjà choisi en entier est signalé.
 */
function stopPanel(ctx: PhoneCtx, arret: string | null, presetP: Promise<Preset> | null): HTMLElement {
  const field = searchField({ id: 'arret-nom', label: T.stopField, placeholder: T.stopSearchPlaceholder, autofocus: true });
  const list = h('ul', { class: 'list box opts', 'aria-label': T.stopsFound, hidden: true });
  const hub = messageHub();
  const msg = hub.slot();
  const done = h('button', { type: 'button', class: 'btn btn-secondary btn-block', hidden: true, onclick: () => ctx.go('#/arrets') }, T.done);
  let preset: Preset | null = null;
  let shown: StopChoice[] = [];
  let seq = 0;
  const nbA = nearBlock('Un autre arrêt');
  const nearStop = (c: StopChoice): HTMLLIElement => {
    const extra = h('span', { class: 'badges-slot' });
    void linesAtStop(ctx, c.areaId).then((ls) => {
      if (ls.length) extra.replaceWith(badgeRow(ctx, c.op, ls));
    });
    const taken = (): boolean => ctx.settings.get().lines.some((x) => x.areaId === c.areaId && !x.line);
    const stop = { areaId: c.areaId, op: c.op, name: c.name, lat: c.lat, lon: c.lon };
    return toggleRow({
      ctx,
      icon: modeIcon(mainMode(c.modes)),
      t1: displayName(c.name, ctx.settings.get().lang),
      t2: typo(c.distanceM !== undefined ? `${c.kind} · ${distanceText(c.distanceM)}` : c.kind),
      extra,
      done: 'Ajouté',
      on: taken,
      toggle: async () => {
        hub.clear();
        if (taken()) await ctx.settings.update((x) => ({ ...x, lines: x.lines.filter((y) => !(y.areaId === c.areaId && !y.line)) }));
        else if (withLine(ctx.settings.get(), stop) === 'full') hub.say(msg, typo(stopLimitText(LIMITS.lines)), true);
        else
          await ctx.settings.update((x) => {
            const r = withLine(x, stop, ctx.clock.now());
            return typeof r === 'object' ? r.settings : x;
          });
        paint();
      },
    });
  };

  const paint = (): void => {
    const s = ctx.settings.get();
    list.replaceChildren(
      ...shown.map((c) => {
        const taken = s.lines.some((x) => x.areaId === c.areaId && !x.line);
        const meta = taken ? T.stopTaken : c.areaId === arret ? T.chosenStop : c.distanceM !== undefined ? typo(distanceText(c.distanceM)) : undefined;
        // 1.2.6 : les lignes de l'arrêt, chacune à sa couleur
        const extra = h('span', { class: 'badges-slot' });
        void linesAtStop(ctx, c.areaId).then((ls) => {
          if (ls.length) extra.replaceWith(badgeRow(ctx, c.op, ls));
        });
        return option({ icon: modeIcon(mainMode(c.modes)), label: displayName(c.name, s.lang), sub: c.kind, meta, verb: 'Ajouter', extra, onPick: () => void pick(c) });
      }),
    );
    list.hidden = !shown.length;
  };

  /** Les arrêts les plus proches dans « Près de toi » : comme les gares, une seule demande de position. */
  let nearTried = false;
  const fillNear = async (): Promise<void> => {
    const known = near(ctx);
    if (nbA.list.children.length || (nearTried && !known)) return;
    nearTried = true;
    try {
      const here = known ?? (await nearPos(ctx));
      if (!here || nbA.list.children.length) return;
      const around = (await (await ctx.core()).nearby(here.lat, here.lon, NEAR_STOPS_M, { light: true }))
        .filter((n) => n.area.op !== 'sncb')
        .slice(0, NEAR_STOPS_MAX)
        .map((n) => ofStopArea(n.area, n.distanceM));
      if (nbA.list.children.length) return;
      nbA.list.replaceChildren(...around.map(nearStop));
      nbA.show(around.length);
    } catch {
      // « Près de toi » reste caché ; la recherche dessous reste utilisable
    }
  };

  const run = async (): Promise<void> => {
    const my = ++seq;
    const q = field.input.value.trim();
    const pos = near(ctx);
    let items: StopChoice[] = [];
    let note = '';
    try {
      const core = await ctx.core();
      if (normalizeForSearch(q).replace(/ /g, '').length >= 2) {
        items = stopsOf(await core.search(q, pos ?? undefined), pos);
        if (!items.length) note = T.stopSearchNone;
      } else {
        // Sans texte : l'arrêt présélectionné ; 1.2.6 : les plus proches dans « Près de toi », au-dessus
        // du champ, un toucher pour les ajouter ou les retirer
        const first = preset?.area && preset.area.op !== 'sncb' ? [ofStopArea(preset.area)] : [];
        void fillNear();
        items = first;
      }
    } catch {
      if (my !== seq) return;
      shown = [];
      paint();
      field.say(T.searchDown, true);
      return;
    }
    if (my !== seq) return;
    shown = items;
    paint();
    field.say(note);
  };

  async function pick(c: StopChoice): Promise<void> {
    const name = displayName(c.name, ctx.settings.get().lang);
    const stop = { areaId: c.areaId, op: c.op, name: c.name, lat: c.lat, lon: c.lon };
    const r = withLine(ctx.settings.get(), stop, ctx.clock.now());
    if (r === 'exists') return hub.say(msg, T.stopExists);
    if (r === 'full') return hub.say(msg, typo(stopLimitText(LIMITS.lines)), true);
    await ctx.settings.update((x) => {
      const again = withLine(x, stop, ctx.clock.now());
      return typeof again === 'object' ? again.settings : x;
    });
    hub.say(msg, typo(stopAddedText(name)));
    done.hidden = false;
    // Prêt pour un autre arrêt : le champ se vide, les arrêts proches reviennent (celui-ci « déjà dans tes arrêts »).
    field.input.value = '';
    await run();
    // le bouton touché a disparu avec la liste : le curseur va à « Terminé » (sans rouvrir le clavier)
    done.focus();
  }

  field.input.addEventListener('input', debounce(() => void run(), TYPE_DELAY_MS));
  field.input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    list.querySelector<HTMLButtonElement>('button')?.focus();
  });
  if (presetP) {
    void presetP.then((p) => {
      preset = p;
      if (!field.input.value.trim()) void run();
    });
  }
  void run();
  return h('div', { class: 'stop-add' }, h('p', { class: 'lead' }, T.stopLead), nbA.box, nbA.other, field.el, msg, done, list);
}

/** Les deux ajouts de bus, tram et métro (1.2.6) : une ligne suivie, ou un arrêt. */
export type LineAddKind = 'line' | 'stop';

/**
 * 1.2.6 : « Ajouter une ligne » (#/lignes/ajouter) ou « Ajouter un arrêt » (#/arrets/ajouter), chacun son écran.
 * La limite atteinte est dite d'emblée (le bouton de l'accueil est alors grisé, pas le lien de « Un endroit »).
 * « Accueil » ramène à l'accueil (revue 1.2.2).
 */
export function addLineScreen(ctx: PhoneCtx, initial: LineAddKind = 'line'): HTMLElement {
  const arret = ctx.params.get('arret');
  const presetP = arret ? loadPreset(ctx, arret) : null;
  const s = ctx.settings.get();
  const stop = initial === 'stop';
  const full = stop ? s.lines.length >= LIMITS.lines : (s.follows ?? []).length >= LIMITS.lines;
  const limit = full ? h('p', { class: 'msg err', role: 'status' }, typo(stop ? stopLimitText(LIMITS.lines) : lineLimitText(LIMITS.lines))) : null;
  return h('div', { class: 'screen' }, header(ctx, stop ? T.addStop : T.addFollow, undefined, { label: 'Accueil', hash: '#/' }), limit, stop ? stopPanel(ctx, arret, presetP) : linePanel(ctx, arret, presetP));
}
