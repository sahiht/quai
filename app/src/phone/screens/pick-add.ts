/**
 * Ajout d'une gare, d'une ligne ou d'un arrêt (PRD-1.2.2 § 4, PRD-1.2.3 § 3), sur le téléphone et dans l'onglet
 * Réglages de Quai Web.
 *  - « Ajouter une gare » : un champ limité aux gares SNCB (core.search filtré), les plus proches d'abord si la
 *    position est connue (sans texte : les gares à moins de 2 km) ; un toucher ajoute ; une gare déjà choisie est
 *    signalée « Déjà dans tes gares ».
 *  - « Ajouter une ligne ou un arrêt » (« Bus, tram, métro ») : deux choix de même taille en haut, comme « Nouveau
 *    favori ». « Une ligne », en deux temps : « Numéro de la ligne » (core.findLines : « Bus W TEC, Braine-l’Alleud ↔
 *    Bruxelles Midi », les plus proches d'abord), puis « À quel arrêt ? » (core.lineStops, le plus proche d'abord,
 *    avec un champ pour filtrer) ; un toucher ajoute et confirme. « Un arrêt » (1.2.3) : un champ limité aux arrêts de
 *    bus, tram et métro (core.search sans les gares SNCB), le plus proche d'abord ; un toucher ajoute l'arrêt avec
 *    toutes ses lignes (LinePick sans `line`). ?arret={zone} (lien de « Un endroit », revue d'usage n° 3) : les
 *    lignes de cet arrêt proposées, l'arrêt présélectionné à la 2e étape, et en tête de « Un arrêt ».
 * Erreurs et listes vides dites en clair ; jamais de coordonnées à l'écran.
 */
import type { AreaSummary, LatLon, LineMatch, LineStop, Mode, Names, Op, SearchItem } from '../../core/api';
import { lineKey } from '../../core/linepicks';
import { displayName, distanceM, kindLabel, mainMode } from '../../core/util';
import { LIMITS } from '../../settings';
import { matchesQuery, normalizeForSearch } from '../../../../shared/names';
import { header, type PhoneCtx } from '../app';
import { debounce, h, icon } from '../dom';
import { distanceText, lineAddedText, lineLimitText, lineMatchText, lineName, notServedText, stationAddedText, stationLimitText, stopAddedText, stopLinesText, T, typo } from '../text';
import { messageHub, nextId, segmentedTabs } from '../ui';
import { withLine, withStation } from './picks';

/** Gares proposées sans texte : à moins de 2 km de la position (3 × 3 tuiles autour d'elle, recherche légère). */
export const NEAR_STATIONS_M = 2000;
export const NEAR_STATIONS_MAX = 5;
const TYPE_DELAY_MS = 200;

/**
 * Proposition d'une liste : icône, nom (et en dessous son type, « tram STIB »), à droite la distance ou l'état ;
 * `verb` lu avant le nom (« Ajouter »).
 */
function option(o: { icon: HTMLSpanElement; label: string; sub?: string; meta?: string; verb?: string; onPick: () => void }): HTMLLIElement {
  return h(
    'li',
    null,
    h(
      'button',
      { type: 'button', class: 'row opt', onclick: o.onPick },
      o.icon,
      h('span', { class: 'txt' }, h('span', { class: 't1' }, o.verb ? h('span', { class: 'sr-only' }, `${o.verb} `) : null, o.label), o.sub ? h('span', { class: 't2' }, o.sub) : null),
      o.meta ? h('span', { class: 'meta' }, o.meta) : null,
    ),
  );
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
      } else if (pos) {
        // Sans texte : les gares les plus proches (recherche légère, sans départs).
        const around = await core.nearby(pos.lat, pos.lon, NEAR_STATIONS_M, { light: true });
        items = around.filter((n) => n.area.op === 'sncb').slice(0, NEAR_STATIONS_MAX).map((n) => ofArea(n.area, n.distanceM));
        if (items.length) note = T.stationNearby;
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
  }

  field.input.addEventListener('input', debounce(() => void run(), TYPE_DELAY_MS));
  field.input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    list.querySelector<HTMLButtonElement>('button')?.focus();
  });
  void run();
  return h('div', { class: 'screen' }, header(ctx, T.addStation, T.stationLead, { label: 'Accueil', hash: '#/' }), field.el, msg, done, list);
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

/** « Une ligne » : le parcours de la 1.2.2, en deux temps (numéro, puis arrêt). */
function linePanel(ctx: PhoneCtx, arret: string | null, presetP: Promise<Preset> | null): HTMLElement {
  const lang = () => ctx.settings.get().lang;
  let preset: Preset | null = null;
  let match: LineMatch | null = null;
  let stops: LineStop[] = [];
  let seq = 0;
  const hub = messageHub();

  /* --- 1. Numéro de la ligne --- */
  const num = searchField({ id: 'ligne-num', label: T.lineField, placeholder: T.linePlaceholder, autofocus: true });
  const quick = h('div', { class: 'quick', hidden: true });
  const found = h('ul', { class: 'list box opts', 'aria-label': T.linesFound, hidden: true });
  const step1 = h('div', { class: 'step' }, num.el, quick, found);

  /* --- 2. À quel arrêt ? --- */
  const titleId = nextId('arret');
  const chosen = h('p', { class: 'chosen-line' });
  const change = h('button', { type: 'button', class: 'btn-link' }, T.changeLine);
  const ask = h('h2', { id: titleId }, typo(T.whichStop));
  const filter = searchField({ id: 'ligne-arret', label: T.stopFilter, placeholder: T.stopPlaceholder });
  const msg2 = hub.slot();
  const again = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, T.anotherLine);
  const done = h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => ctx.go('#/lignes') }, T.done);
  const after = h('div', { class: 'after-add', hidden: true }, again, done);
  const stopList = h('ul', { class: 'list box opts', 'aria-labelledby': titleId, hidden: true });
  const step2 = h('div', { class: 'step', hidden: true }, h('div', { class: 'chosen' }, chosen, change), ask, filter.el, msg2, after, stopList);

  /** Position pour trier : l'arrêt présélectionné, sinon la position du téléphone. */
  const ref = (): LatLon | null => (preset?.area ? { lat: preset.area.lat, lon: preset.area.lon } : near(ctx));

  const paintFound = (ms: LineMatch[]): void => {
    found.replaceChildren(
      ...ms.map((m) =>
        option({
          icon: modeIcon(m.mode),
          label: lineMatchText(m, lang()),
          meta: m.nearest ? typo(distanceText(m.nearest.distanceM)) : undefined,
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

  const paintStops = (): void => {
    const s = ctx.settings.get();
    const m = match;
    if (!m) return;
    const q = filter.input.value.trim();
    const shown = q ? stops.filter((st) => matchesQuery(q, st.name.fr, st.name.nl)) : stops;
    stopList.replaceChildren(
      ...shown.map((st) => {
        const taken = s.lines.some((x) => x.areaId === st.areaId && x.op === m.op && !!x.line && lineKey(x.line) === lineKey(m.line));
        const meta = taken ? T.lineTaken : st.areaId === arret ? T.chosenStop : st.distanceM !== undefined ? typo(distanceText(st.distanceM)) : undefined;
        return option({ icon: modeIcon(m.mode), label: displayName(st.name, s.lang), meta, verb: 'Ajouter', onPick: () => void add(st) });
      }),
    );
    stopList.hidden = !shown.length;
    if (!stops.length) filter.say(T.stopsNone);
    else if (!shown.length) filter.say(T.stopNone);
    else if (arret && preset?.area && !stops.some((st) => st.areaId === arret)) filter.say(notServedText(displayName(preset.area.n, s.lang)));
    else filter.say('');
  };

  async function choose(m: LineMatch): Promise<void> {
    match = m;
    stops = [];
    hub.clear();
    after.hidden = true;
    filter.input.value = '';
    chosen.textContent = lineMatchText(m, lang());
    step1.hidden = true;
    step2.hidden = false;
    stopList.replaceChildren();
    stopList.hidden = true;
    filter.say(T.stopsLoading);
    ask.tabIndex = -1;
    ask.focus();
    const my = ++seq;
    try {
      const list = await (await ctx.core()).lineStops(m, ref());
      if (my !== seq) return;
      // L'arrêt présélectionné d'abord (il est à 0 m de lui-même quand la ligne le dessert).
      stops = arret ? [...list.filter((st) => st.areaId === arret), ...list.filter((st) => st.areaId !== arret)] : list;
      paintStops();
    } catch {
      if (my !== seq) return;
      stops = [];
      stopList.hidden = true;
      filter.say(T.searchDown, true);
    }
  }

  async function add(st: LineStop): Promise<void> {
    const m = match;
    if (!m) return;
    const pick = { areaId: st.areaId, op: m.op, name: st.name, lat: st.lat, lon: st.lon, line: m.line, mode: m.mode };
    const r = withLine(ctx.settings.get(), pick, ctx.clock.now());
    if (r === 'exists') return hub.say(msg2, T.lineExists);
    if (r === 'full') return hub.say(msg2, typo(lineLimitText(LIMITS.lines)), true);
    await ctx.settings.update((x) => {
      const next = withLine(x, pick, ctx.clock.now());
      return typeof next === 'object' ? next.settings : x;
    });
    hub.say(msg2, typo(lineAddedText(m, displayName(st.name, lang()))));
    after.hidden = false;
    paintStops();
  }

  const back = (clear: boolean): void => {
    seq++;
    match = null;
    hub.clear();
    step2.hidden = true;
    step1.hidden = false;
    if (clear) {
      num.input.value = '';
      paintFound([]);
      num.say('');
    }
    num.input.focus();
  };
  change.addEventListener('click', () => back(false));
  again.addEventListener('click', () => back(true));
  filter.input.addEventListener('input', paintStops);

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
  return h('div', { class: 'line-add' }, h('p', { class: 'lead' }, T.lineLead), step1, step2);
}

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
  const done = h('button', { type: 'button', class: 'btn btn-secondary btn-block', hidden: true, onclick: () => ctx.go('#/lignes') }, T.done);
  let preset: Preset | null = null;
  let shown: StopChoice[] = [];
  let seq = 0;

  const paint = (): void => {
    const s = ctx.settings.get();
    list.replaceChildren(
      ...shown.map((c) => {
        const taken = s.lines.some((x) => x.areaId === c.areaId && !x.line);
        const meta = taken ? T.stopTaken : c.areaId === arret ? T.chosenStop : c.distanceM !== undefined ? typo(distanceText(c.distanceM)) : undefined;
        return option({ icon: modeIcon(mainMode(c.modes)), label: displayName(c.name, s.lang), sub: c.kind, meta, verb: 'Ajouter', onPick: () => void pick(c) });
      }),
    );
    list.hidden = !shown.length;
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
        // Sans texte : l'arrêt présélectionné, puis les plus proches (recherche légère, sans départs).
        const first = preset?.area && preset.area.op !== 'sncb' ? [ofStopArea(preset.area)] : [];
        let around: StopChoice[] = [];
        if (pos) {
          around = (await core.nearby(pos.lat, pos.lon, NEAR_STOPS_M, { light: true }))
            .filter((n) => n.area.op !== 'sncb' && !first.some((x) => x.areaId === n.area.id))
            .slice(0, NEAR_STOPS_MAX)
            .map((n) => ofStopArea(n.area, n.distanceM));
          if (around.length) note = T.stationNearby;
        }
        items = [...first, ...around];
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
    if (r === 'full') return hub.say(msg, typo(lineLimitText(LIMITS.lines)), true);
    await ctx.settings.update((x) => {
      const again = withLine(x, stop, ctx.clock.now());
      return typeof again === 'object' ? again.settings : x;
    });
    hub.say(msg, typo(stopAddedText(name)));
    done.hidden = false;
    // Prêt pour un autre arrêt : le champ se vide, les arrêts proches reviennent (celui-ci « déjà dans tes arrêts »).
    field.input.value = '';
    await run();
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
  return h('div', { class: 'stop-add' }, h('p', { class: 'lead' }, T.stopLead), field.el, msg, done, list);
}

/** Les deux choix de l'ajout dans « Bus, tram, métro » (PRD-1.2.3 § 3). */
export type LineAddKind = 'line' | 'stop';

/**
 * « Ajouter une ligne ou un arrêt » : en haut, « Une ligne » (« numéro, puis arrêt », choisie d'office) et « Un arrêt »
 * (« toutes ses lignes »), de même taille, comme « Nouveau favori » ; chacun montre son formulaire. `initial` : le choix
 * montré à l'ouverture (#/lignes/ajouter/ligne, #/lignes/ajouter/arret). « Accueil » ramène à l'accueil (revue 1.2.2).
 */
export function addLineScreen(ctx: PhoneCtx, initial: LineAddKind = 'line'): HTMLElement {
  const arret = ctx.params.get('arret');
  const presetP = arret ? loadPreset(ctx, arret) : null;
  const kinds = segmentedTabs<LineAddKind>({
    label: T.kindsLegend,
    value: initial,
    options: [
      { value: 'line', label: T.kindLine, sub: T.kindLineSub, panel: linePanel(ctx, arret, presetP) },
      { value: 'stop', label: T.kindStop, sub: T.kindStopSub, panel: stopPanel(ctx, arret, presetP) },
    ],
  });
  // Curseur à l'ouverture : le champ du choix montré (le routeur prend le premier champ data-autofocus).
  for (const p of kinds.panels) if (p.hidden) p.querySelectorAll('[data-autofocus]').forEach((e) => e.removeAttribute('data-autofocus'));
  // Limite des lignes atteinte (LIMITS.lines) : on le dit d'emblée (le bouton de l'accueil est alors grisé, pas le lien de « Un endroit »).
  const full = ctx.settings.get().lines.length >= LIMITS.lines ? h('p', { class: 'msg err', role: 'status' }, typo(lineLimitText(LIMITS.lines))) : null;
  return h('div', { class: 'screen' }, header(ctx, T.addLine, undefined, { label: 'Accueil', hash: '#/' }), full, kinds.el, ...kinds.panels);
}
