/**
 * Rechercher un trajet (maquettes Recherche et Visite3) : départ, arrivée, propositions des quatre
 * réseaux, trains (direct ou une correspondance) ou trajet porte à porte, « Afficher dans les lunettes ».
 */
import type { Core, Endpoint, Journey, Leg, SearchItem } from '../../core/api';
import { displayName, hhmm, lineLabel, mainMode } from '../../core/util';
import type { AreaSummary, Mode } from '../../../../shared/types';
import type { AreaRef, Route } from '../../glasses/types';
import { dayWord, durationText, transfersText, vehicleOf } from '../../glasses/format';
import { header, type PhoneCtx } from '../app';
import { debounce, h, ICON, liveRegion } from '../dom';

type End =
  | { kind: 'here'; label: string }
  | { kind: 'area'; area: AreaRef & { modes: Mode[] }; label: string }
  | { kind: 'place'; placeId: string; label: string };

const MODE_TITLE: Record<Mode, string> = { train: 'Train', metro: 'Métro', tram: 'Tram', bus: 'Bus' };

function toEndpoint(e: End): Endpoint {
  if (e.kind === 'here') return { type: 'here' };
  if (e.kind === 'place') return { type: 'place', placeId: e.placeId };
  const { areaId, op, name, lat, lon } = e.area;
  return { type: 'area', areaId, op, name, lat, lon };
}

const areaOf = (a: AreaSummary | SearchItem): AreaRef & { modes: Mode[] } => ({
  areaId: a.id,
  op: a.op,
  name: 'n' in a ? a.n : (a as AreaSummary).n,
  lat: a.lat,
  lon: a.lon,
  modes: a.modes,
});

const rides = (j: Journey): Leg[] => j.legs.filter((l) => l.kind === 'ride');

/** « direct, voie 4, à l’heure » (trains). */
export function trainMeta(j: Journey): string {
  const r = rides(j);
  const first = r[0];
  const delay = Math.max(0, ...r.map((x) => x.delayMin ?? 0));
  const cancelled = r.some((x) => x.cancelled);
  const p = first?.newPlatform || first?.platform;
  const status = cancelled ? 'supprimé' : delay > 0 ? `+${delay} min` : j.rt ? 'à l’heure' : 'horaire prévu ~';
  return [transfersText(j.transfers), p ? `voie ${p}` : '', status].filter(Boolean).join(', ');
}

/** Détail sous les étiquettes : « Voie 9 à Bruxelles-Nord, à l’heure ». */
export function rideDetail(j: Journey, lang: 'fr' | 'nl' | 'local'): string {
  const first = rides(j)[0];
  if (!first) return 'À pied, sans transport';
  const p = first.newPlatform || first.platform;
  const where = displayName(first.from.name, lang);
  const delay = first.delayMin ?? 0;
  const status = first.cancelled ? 'supprimé' : delay > 0 ? `retard de ${delay} min annoncé` : first.rt ? 'à l’heure' : 'horaire prévu, sans temps réel';
  if (first.mode === 'train' && p) return `Voie ${p} à ${where}, ${status}`;
  return `${vehicleOf(first)} à ${where}, ${status}${first.last && !first.cancelled ? ', dernier passage' : ''}`;
}

export function searchScreen(ctx: PhoneCtx): HTMLElement {
  const s = ctx.settings.get();
  const live = liveRegion();
  let from: End | null = { kind: 'here', label: 'Ma position' };
  let to: End | null = null;
  let after: number | null = null;
  let results: Journey[] = [];
  let mode: 'trains' | 'plan' = 'trains';
  let stations: { from: AreaRef; to: AreaRef } | null = null;
  let selected = 0;

  const depInput = h('input', { id: 'r-depart', type: 'text', value: from.label, autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'r-props', 'aria-autocomplete': 'list' });
  const arrInput = h('input', { id: 'r-arrivee', type: 'text', value: '', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'r-props', 'aria-autocomplete': 'list', style: 'font-weight:500' });
  const props = h('ul', { class: 'suggest', id: 'r-props', role: 'listbox', 'aria-label': 'Gares et arrêts proposés' });
  const resultsBox = h('div', { style: 'display:flex;flex-direction:column;gap:12px' });
  const showBtn = h('button', { type: 'button', class: 'btn btn-primary btn-big btn-block', disabled: true, html: `${ICON.glasses}<span>Afficher dans les lunettes</span>` });
  let active: 'from' | 'to' = 'to';

  const setInputs = (): void => {
    depInput.value = from?.label ?? '';
    arrInput.value = to?.label ?? '';
  };

  async function core(): Promise<Core> {
    return ctx.core();
  }

  async function hereLabel(): Promise<void> {
    if (from?.kind !== 'here') return;
    const fix = ctx.location.last() ?? (await ctx.location.current(6000));
    if (!fix) return;
    try {
      const near = await (await core()).nearby(fix.lat, fix.lon, 300);
      const st = near.find((n) => mainMode(n.area.modes) === 'train') ?? near[0];
      if (st && from?.kind === 'here') {
        from.label = `Ma position, ${displayName(st.area.n, s.lang)}`;
        if (document.activeElement !== depInput) depInput.value = from.label;
      }
    } catch {
      /* sans nom de lieu */
    }
  }

  const option = (label: string, sub: string, pick: () => void, selectedOpt = false): HTMLLIElement =>
    h('li', { role: 'none' }, h('button', { type: 'button', role: 'option', 'aria-selected': selectedOpt ? 'true' : 'false', onclick: pick }, h('span', { class: 's1' }, label), h('span', { class: 's2' }, sub)));

  const choose = (e: End): void => {
    if (active === 'from') from = e;
    else to = e;
    setInputs();
    props.replaceChildren();
    depInput.setAttribute('aria-expanded', 'false');
    arrInput.setAttribute('aria-expanded', 'false');
    if (e.kind === 'here') void hereLabel();
    void run();
  };

  const suggest = debounce(async () => {
    const input = active === 'from' ? depInput : arrInput;
    const q = input.value.trim();
    props.replaceChildren();
    const lower = q.toLowerCase();
    if (!q || 'ma position'.startsWith(lower)) props.appendChild(option('Ma position', 'position actuelle', () => choose({ kind: 'here', label: 'Ma position' })));
    for (const p of s.places) if (!q || p.label.toLowerCase().startsWith(lower)) props.appendChild(option(p.label, 'mon lieu', () => choose({ kind: 'place', placeId: p.id, label: p.label })));
    if (q.length >= 2) {
      try {
        const items = await (await core()).search(q, ctx.location.last() ?? undefined);
        items.slice(0, 8).forEach((it, i) => {
          const label = displayName(it.n, s.lang);
          props.appendChild(option(label, it.kindLabel, () => choose({ kind: 'area', area: areaOf(it), label }), i === 0));
        });
        if (!items.length) props.appendChild(h('li', { class: 'small muted', style: 'padding:10px 12px' }, 'Aucun arrêt ne correspond.'));
      } catch (e) {
        live.say(e instanceof Error ? e.message : 'Recherche indisponible', true);
      }
    }
    input.setAttribute('aria-expanded', props.children.length ? 'true' : 'false');
  }, 200);

  for (const [input, which] of [
    [depInput, 'from'],
    [arrInput, 'to'],
  ] as const) {
    input.addEventListener('focus', () => {
      active = which;
      input.select();
      suggest();
    });
    input.addEventListener('input', () => {
      active = which;
      suggest();
    });
  }

  const swap = h('button', { type: 'button', class: 'swap', 'aria-label': 'Inverser départ et arrivée', html: ICON.swap });
  swap.addEventListener('click', () => {
    [from, to] = [to, from];
    setInputs();
    void run();
  });

  const timeInput = h('input', { type: 'time', class: 'input', style: 'max-width:140px', 'aria-label': 'Heure de départ' });
  const timeBox = h('div', { hidden: true, style: 'display:flex;gap:8px;align-items:center' }, timeInput, h('button', { type: 'button', class: 'btn-link', onclick: () => { after = null; timeBox.hidden = true; void run(); } }, 'Maintenant'));
  timeInput.addEventListener('change', () => {
    const [hh, mm] = timeInput.value.split(':').map(Number);
    if (!Number.isFinite(hh)) return;
    // Heure belge : on part de l'heure actuelle (à la minute) et on décale de la différence demandée.
    const now = ctx.clock.now();
    const [ch, cm] = hhmm(now).split(':').map(Number);
    let t = now - (now % 60_000) + ((hh - ch) * 60 + ((mm || 0) - cm)) * 60_000;
    if (t < now - 3_600_000) t += 86_400_000;
    after = t;
    void run();
  });

  function card(j: Journey, i: number): HTMLLIElement {
    const r = rides(j);
    const start = mode === 'trains' ? r[0]?.schedDep ?? j.dep : r.length ? j.leaveAt : j.dep;
    const end = mode === 'trains' ? r[r.length - 1]?.arr ?? j.arr : j.arr;
    // heure d'un autre jour : « demain 08:42 → 09:46 »
    const day = dayWord(start, ctx.clock.now());
    const times = `${day ? day + ' ' : ''}${hhmm(start)} → ${hhmm(end)}`;
    const btn = h('button', { type: 'button', class: 'card', 'aria-pressed': i === selected ? 'true' : 'false' });
    btn.addEventListener('click', () => {
      selected = i;
      resultsBox.querySelectorAll('.card').forEach((c, k) => c.setAttribute('aria-pressed', k === i ? 'true' : 'false'));
    });
    if (mode === 'trains') {
      btn.append(h('span', { class: 'r1' }, h('span', { class: 'time' }, times), h('span', { class: 'dur' }, trainMeta(j))));
    } else {
      const chips = j.legs.map((l) =>
        l.kind === 'walk'
          ? h('span', { class: 'chip walk', html: `${ICON.walk}<span>${l.walkMin ?? Math.max(1, Math.round((l.arr - l.dep) / 60_000))} min</span>` })
          : h('span', { class: 'chip', html: `${l.mode === 'train' ? ICON.trainSmall : l.mode === 'bus' ? ICON.busSmall : ICON.tramSmall}<span>${l.mode && l.mode !== 'train' ? `${MODE_TITLE[l.mode]} ${l.line ?? ''}` : vehicleOf(l)}</span>` }),
      );
      const withSep = chips.flatMap((c, k) => (k ? [h('span', { 'aria-hidden': 'true', style: 'color:#8A938C' }, '›'), c] : [c]));
      btn.append(
        h('span', { class: 'r1' }, h('span', { class: 'time' }, times), h('span', { class: 'dur' }, `${durationText((end - start) / 60_000)}, ${transfersText(j.transfers)}`)),
        h('span', { class: 'chips' }, withSep),
        h('span', { class: 'det' }, rideDetail(j, s.lang)),
      );
    }
    return h('li', null, btn);
  }

  function paint(): void {
    resultsBox.replaceChildren();
    showBtn.disabled = !results.length;
    if (!from || !to) return;
    const fromName = stations ? displayName(stations.from.name, s.lang) : from.label.replace(/^Ma position, /, '');
    const toName = stations ? displayName(stations.to.name, s.lang) : to.label;
    const t = after ?? ctx.clock.now();
    resultsBox.append(
      h(
        'div',
        { class: 'res-head' },
        h('div', { style: 'display:flex;flex-direction:column' }, h('h2', null, `${fromName} → ${toName}`), h('span', { class: 'small muted' }, after ? `départs dès ${hhmm(t)}` : `dès ${hhmm(t)}`)),
        h('button', { type: 'button', class: 'btn-link', onclick: () => { timeBox.hidden = !timeBox.hidden; if (!timeBox.hidden) timeInput.focus(); } }, 'Changer l’heure'),
      ),
      timeBox,
      results.length ? h('ul', { class: 'results', 'aria-label': 'Propositions' }, results.map(card)) : h('p', { class: 'small' }, 'Aucun trajet trouvé à cette heure.'),
    );
  }

  async function run(): Promise<void> {
    if (!from || !to) {
      paint();
      return;
    }
    live.say('Recherche…');
    showBtn.disabled = true;
    try {
      const c = await core();
      const now = after ?? ctx.clock.now();
      const needHere = from.kind === 'here' || to.kind === 'here';
      const fix = needHere ? ctx.location.last() ?? (await ctx.location.current(8000)) : ctx.location.last();
      if (needHere && !fix) throw new Error(ctx.web ? 'Position inconnue : autorise-la dans le navigateur, ou choisis un arrêt (onglet Lunettes, rubrique Position).' : 'Position inconnue : autorise la position pour Quai.');
      let fromSt: AreaRef | null = from.kind === 'area' && from.area.op === 'sncb' ? from.area : null;
      if (!fromSt && from.kind === 'here' && fix) {
        const near = await c.nearby(fix.lat, fix.lon, 300);
        const st = near.find((n) => mainMode(n.area.modes) === 'train');
        if (st) fromSt = areaOf(st.area);
      }
      const toSt: AreaRef | null = to.kind === 'area' && to.area.op === 'sncb' ? to.area : null;
      if (fromSt && toSt) {
        mode = 'trains';
        stations = { from: fromSt, to: toSt };
        results = await c.trains(fromSt.areaId, toSt.areaId, now, 3);
      } else {
        mode = 'plan';
        stations = null;
        results = await c.plan(toEndpoint(from), toEndpoint(to), now, ctx.settings.get(), fix ? { lat: fix.lat, lon: fix.lon } : undefined);
      }
      selected = 0;
      live.say(results.length ? `${results.length} proposition${results.length > 1 ? 's' : ''}.` : 'Aucun trajet trouvé.');
    } catch (e) {
      results = [];
      live.say(e instanceof Error ? e.message : 'Recherche impossible', true);
    }
    paint();
  }

  showBtn.addEventListener('click', async () => {
    const g = ctx.glasses();
    const j = results[selected];
    if (!g || !j || !to) {
      live.say('Lunettes indisponibles pour l’instant.', true);
      return;
    }
    let route: Route;
    if (mode === 'trains' && stations) route = { screen: 'trip', from: stations.from, to: stations.to };
    else route = { screen: 'steps', journey: j, label: to.label, leaveAt0: j.leaveAt };
    await g.show(route);
    live.say('Affiché dans les lunettes.');
    ctx.showGlasses?.();
  });

  // Liens directs : #/recherche?q=Gand (saisie), ?de=ici&vers=sncb:8892007 (recherche lancée).
  void (async () => {
    const q = ctx.params.get('q');
    const vers = ctx.params.get('vers');
    const de = ctx.params.get('de');
    void hereLabel();
    if (q) {
      arrInput.value = q;
      active = 'to';
      suggest();
    }
    if (vers) {
      try {
        const c = await core();
        const resolve = async (id: string): Promise<End | null> => {
          if (id === 'ici') return { kind: 'here', label: 'Ma position' };
          const place = s.places.find((p) => p.id === id);
          if (place) return { kind: 'place', placeId: place.id, label: place.label };
          const b = await c.board(id, { limit: 1 });
          return { kind: 'area', area: areaOf(b.area), label: displayName(b.area.n, s.lang) };
        };
        to = await resolve(vers);
        if (de && de !== 'ici') from = await resolve(de);
        setInputs();
        await hereLabel();
        await run();
      } catch (e) {
        live.say(e instanceof Error ? e.message : 'Arrêt introuvable', true);
      }
    }
  })();

  return h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:18px' },
    header(ctx, 'Rechercher un trajet', undefined, { label: 'Accueil', hash: '#/' }),
    h(
      'div',
      { class: 'od' },
      h('div', { class: 'end' }, h('label', { for: 'r-depart' }, 'Départ'), h('div', { style: 'display:flex;align-items:center;gap:8px', html: ICON.pin }, depInput)),
      h('div', { class: 'end' }, h('label', { for: 'r-arrivee' }, 'Arrivée'), arrInput),
      swap,
    ),
    props,
    resultsBox,
    showBtn,
    live.el,
    h('p', { class: 'foot' }, 'Recherche sur SNCB, STIB, De Lijn et TEC'),
  );
}

export { lineLabel };
