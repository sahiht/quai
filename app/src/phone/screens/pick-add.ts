/**
 * Ajout d'une gare et d'une ligne (PRD-1.2.2 § 4), sur le téléphone et dans l'onglet Réglages de Quai Web.
 *  - « Ajouter une gare » : un champ limité aux gares SNCB (core.search filtré), les plus proches d'abord si la
 *    position est connue (sans texte : les gares à moins de 2 km) ; un toucher ajoute ; une gare déjà choisie est
 *    signalée « Déjà dans tes gares ».
 *  - « Ajouter une ligne », en deux temps : « Numéro de la ligne » (core.findLines : « Bus W TEC, Braine-l’Alleud ↔
 *    Bruxelles Midi », les plus proches d'abord), puis « À quel arrêt ? » (core.lineStops, le plus proche d'abord,
 *    avec un champ pour filtrer) ; un toucher ajoute et confirme. ?arret={zone} (lien de « Un endroit », revue
 *    d'usage n° 3) : les lignes de cet arrêt proposées, l'arrêt présélectionné à la 2e étape.
 * Erreurs et listes vides dites en clair ; jamais de coordonnées à l'écran.
 */
import type { AreaSummary, LatLon, LineMatch, LineStop, Mode, Names, Op, SearchItem } from '../../core/api';
import { lineKey } from '../../core/linepicks';
import { displayName, distanceM } from '../../core/util';
import { LIMITS } from '../../settings';
import { matchesQuery, normalizeForSearch } from '../../../../shared/names';
import { header, type PhoneCtx } from '../app';
import { debounce, h, icon } from '../dom';
import { distanceText, lineAddedText, lineLimitText, lineMatchText, lineName, notServedText, stationAddedText, stationLimitText, stopLinesText, T, typo } from '../text';
import { messageHub, nextId } from '../ui';
import { withLine, withStation } from './picks';

/** Gares proposées sans texte : à moins de 2 km de la position (3 × 3 tuiles autour d'elle, recherche légère). */
export const NEAR_STATIONS_M = 2000;
export const NEAR_STATIONS_MAX = 5;
const TYPE_DELAY_MS = 200;

/** Proposition d'une liste : icône, nom, à droite la distance ou l'état ; `verb` lu avant le nom (« Ajouter »). */
function option(o: { icon: HTMLSpanElement; label: string; meta?: string; verb?: string; onPick: () => void }): HTMLLIElement {
  return h(
    'li',
    null,
    h(
      'button',
      { type: 'button', class: 'row opt', onclick: o.onPick },
      o.icon,
      h('span', { class: 'txt' }, h('span', { class: 't1' }, o.verb ? h('span', { class: 'sr-only' }, `${o.verb} `) : null, o.label)),
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

/* ------------------------------ Ajouter une ligne ------------------------------ */

/** Arrêt présélectionné (?arret=…) : sa zone, et ses lignes de bus, tram et métro (« Tram 3 », « Tram 4 »). */
interface Preset { area: AreaSummary | null; lines: { line: string; mode: Mode }[] }

/** Lignes d'un arrêt, une fois chacune (linesAt donne une entrée par direction), sans les trains. */
export function linesOfStop(lines: readonly { line: string; mode: Mode }[]): { line: string; mode: Mode }[] {
  const out: { line: string; mode: Mode }[] = [];
  for (const l of lines) if (l.mode !== 'train' && !out.some((x) => lineKey(x.line) === lineKey(l.line))) out.push({ line: l.line, mode: l.mode });
  return out;
}

const modeIcon = (mode: Mode): HTMLSpanElement => icon(mode === 'bus' ? 'bus' : mode === 'train' ? 'train' : 'tram');

export function addLineScreen(ctx: PhoneCtx): HTMLElement {
  const lang = () => ctx.settings.get().lang;
  const arret = ctx.params.get('arret');
  let preset: Preset | null = null;
  let match: LineMatch | null = null;
  let stops: LineStop[] = [];
  let seq = 0;
  const hub = messageHub();

  /* --- 1. Numéro de la ligne --- */
  const num = searchField({ id: 'ligne-num', label: T.lineField, placeholder: T.linePlaceholder, autofocus: true });
  const quick = h('div', { class: 'quick', hidden: true });
  const found = h('ul', { class: 'list box opts', 'aria-label': T.linesFound, hidden: true });
  // Limite des lignes atteinte (LIMITS.lines) : on le dit d'emblée (le bouton de l'accueil est alors grisé, pas le lien de « Un endroit »).
  const full = ctx.settings.get().lines.length >= LIMITS.lines;
  const limit = full ? h('p', { class: 'msg err', role: 'status' }, typo(lineLimitText(LIMITS.lines))) : null;
  const step1 = h('div', { class: 'step' }, limit, num.el, quick, found);

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
  if (arret) {
    void (async () => {
      try {
        const core = await ctx.core();
        const [area, lines] = await Promise.all([
          core.board(arret, { limit: 1 }).then((b) => b.area).catch(() => null),
          core.linesAt(arret).catch(() => []),
        ]);
        preset = { area, lines: linesOfStop(lines) };
      } catch {
        preset = { area: null, lines: [] };
      }
      if (!preset.lines.length) return;
      const where = preset.area ? displayName(preset.area.n, lang()) : '';
      quick.replaceChildren(
        h('p', { class: 'small' }, typo(stopLinesText(where))),
        h(
          'div',
          { class: 'shortcuts', role: 'group', 'aria-label': stopLinesText(where).replace(/ :$/, '') },
          preset.lines.map((l) =>
            h('button', {
              type: 'button',
              class: 'shortcut',
              onclick: () => {
                num.input.value = l.line;
                void search();
              },
            }, lineName({ op: (preset?.area?.op ?? arret.split(':')[0]) as Op, line: l.line, mode: l.mode })),
          ),
        ),
      );
      quick.hidden = false;
    })();
  }
  return h('div', { class: 'screen' }, header(ctx, T.addLine, T.lineLead, { label: 'Accueil', hash: '#/' }), step1, step2);
}
