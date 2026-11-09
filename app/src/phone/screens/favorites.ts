/** Réglage 3 sur 6 : favoris (arrêt avec lignes et directions, ou trajet A → B). Maquettes Config3 et Favoris. */
import type { Endpoint, Favorite, FavoriteStop, FavoriteTrip, LineFilter, Mode, Propose, SearchItem } from '../../core/api';
import { OP_NAME, displayName, mainMode } from '../../core/util';
import type { Names, Op } from '../../../../shared/types';
import { LIMITS, newId } from '../../settings';
import { headText } from '../../glasses/format';
import { header, type PhoneCtx } from '../app';
import { debounce, h, icon, ICON, liveRegion } from '../dom';
import { listRow, radios, segmented } from '../ui';

const MODE_TITLE: Record<Mode, string> = { train: 'Train', metro: 'Métro', tram: 'Tram', bus: 'Bus' };
const MODE_PLURAL: Record<Mode, string> = { train: 'trains', metro: 'métros', tram: 'trams', bus: 'bus' };
const PROPOSE_TEXT: Record<Propose, string> = { never: '', near: 'proposé à moins de 300 m', morning: 'proposé le matin', evening: 'proposé le soir' };

export const PROPOSE_OPTIONS: { value: Propose; label: string }[] = [
  { value: 'never', label: 'Jamais' },
  { value: 'near', label: 'Quand je suis à moins de 300 m' },
  { value: 'morning', label: 'Le matin' },
  { value: 'evening', label: 'Le soir' },
];

/** « trams 3 et 4 » à partir du filtre et du mode. */
export function linesText(lines: string[], mode: Mode | undefined): string {
  const uniq = [...new Set(lines)];
  if (!uniq.length) return mode ? MODE_PLURAL[mode] : '';
  const word = mode ? (uniq.length > 1 ? MODE_PLURAL[mode] : MODE_TITLE[mode].toLowerCase()) : uniq.length > 1 ? 'lignes' : 'ligne';
  const list = uniq.length > 1 ? `${uniq.slice(0, -1).join(', ')} et ${uniq[uniq.length - 1]}` : uniq[0];
  return `${word} ${list}`;
}

function endpointText(e: Endpoint, ctx: PhoneCtx): string {
  const s = ctx.settings.get();
  if (e.type === 'here') return 'Ma position';
  if (e.type === 'area') return displayName(e.name, s.lang);
  return s.places.find((p) => p.id === e.placeId)?.label ?? 'Lieu';
}

/** Sous-titre d'un favori : « Arrêt STIB, trams 3 et 4 », « Trajet en train, proposé le soir ». */
export function favoriteSubtitle(f: Favorite): string {
  if (f.kind === 'stop') {
    const lines = f.filter?.map((x) => x.line) ?? [];
    const mode: Mode | undefined = f.op === 'sncb' ? 'train' : f.op === 'stib' ? undefined : 'bus';
    const what = f.op === 'sncb' ? 'Gare SNCB' : `Arrêt ${OP_NAME[f.op]}`;
    const l = linesText(lines, mode);
    return [what + (l ? `, ${l}` : ''), PROPOSE_TEXT[f.propose]].filter(Boolean).join(', ');
  }
  const train = f.from.type === 'area' && f.to.type === 'area' && f.from.op === 'sncb' && f.to.op === 'sncb';
  return [train ? 'Trajet en train' : 'Trajet porte à porte', PROPOSE_TEXT[f.propose]].filter(Boolean).join(', ');
}

function favIcon(f: Favorite): HTMLSpanElement {
  if (f.kind === 'trip') return icon('trip');
  if (f.op === 'sncb') return icon('train');
  if (f.op === 'stib' || (f.filter ?? []).length === 0) return icon(f.op === 'stib' ? 'tram' : 'bus');
  return icon('bus');
}

export function favoritesScreen(ctx: PhoneCtx): HTMLElement {
  const s = ctx.settings.get();
  const list = h('ul', { class: 'list box' });
  for (const f of s.favorites) {
    const title = f.kind === 'stop' ? displayName(f.name, s.lang) : `${endpointText(f.from, ctx)} → ${endpointText(f.to, ctx)}`;
    list.appendChild(listRow({ icon: favIcon(f), title, sub: favoriteSubtitle(f), label: `Modifier ${f.kind === 'stop' ? 'l’arrêt' : 'le trajet'} ${title}`, onClick: () => ctx.go(`#/favoris/${encodeURIComponent(f.id)}`) }));
  }
  if (!s.favorites.length) list.appendChild(h('li', { class: 'small', style: 'padding:14px 16px' }, 'Aucun favori pour l’instant.'));
  return h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:16px' },
    header(ctx, 'Mes favoris', 'Le premier peut s’ouvrir au lancement (réglage Affichage).', { label: 'Accueil', hash: '#/' }),
    list,
    h('button', { type: 'button', class: 'btn btn-primary btn-block', style: 'min-height:48px', disabled: s.favorites.length >= LIMITS.favorites, onclick: () => ctx.go('#/favoris/nouveau'), html: `${ICON.plusWhite}<span>Ajouter un arrêt, une gare ou un trajet</span>` }),
  );
}

interface AreaPick { areaId: string; op: Op; name: Names; lat: number; lon: number; modes: Mode[]; kindLabel?: string }

/** Champ de recherche d'arrêt avec propositions (core.search), plus options fixes (Ma position, lieux). */
function stopPicker(ctx: PhoneCtx, opts: { id: string; label: string; value: string; extra?: () => { label: string; sub: string; pick: () => void }[]; onPick: (a: AreaPick) => void }): HTMLElement {
  const s = ctx.settings.get();
  const input = h('input', { id: opts.id, class: 'input', type: 'search', value: opts.value, autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': `${opts.id}-list`, 'aria-autocomplete': 'list' });
  const list = h('ul', { class: 'suggest', id: `${opts.id}-list`, role: 'listbox', 'aria-label': `${opts.label} : propositions` });
  const option = (label: string, sub: string, pick: () => void): HTMLLIElement =>
    h('li', { role: 'none' }, h('button', { type: 'button', role: 'option', onclick: () => { pick(); list.replaceChildren(); input.setAttribute('aria-expanded', 'false'); } }, h('span', { class: 's1' }, label), h('span', { class: 's2' }, sub)));
  const run = debounce(async () => {
    const q = input.value.trim();
    list.replaceChildren();
    for (const x of opts.extra?.() ?? []) if (!q || x.label.toLowerCase().includes(q.toLowerCase())) list.appendChild(option(x.label, x.sub, x.pick));
    if (q.length >= 2) {
      try {
        const core = await ctx.core();
        const items: SearchItem[] = await core.search(q, ctx.location.last() ?? undefined);
        for (const it of items.slice(0, 8)) {
          const label = displayName(it.n, s.lang);
          list.appendChild(option(label, it.kindLabel, () => {
            input.value = label;
            opts.onPick({ areaId: it.id, op: it.op, name: it.n, lat: it.lat, lon: it.lon, modes: it.modes, kindLabel: it.kindLabel });
          }));
        }
      } catch {
        /* recherche indisponible : la liste reste vide */
      }
    }
    input.setAttribute('aria-expanded', list.children.length ? 'true' : 'false');
  }, 220);
  input.addEventListener('input', run);
  input.addEventListener('focus', run);
  return h('div', { class: 'field' }, h('label', { for: opts.id }, opts.label), input, list);
}

export function favoriteEditScreen(ctx: PhoneCtx, id: string): HTMLElement {
  const s = ctx.settings.get();
  const existing = s.favorites.find((f) => f.id === id);
  const isNew = !existing;
  let kind: 'stop' | 'trip' = existing?.kind ?? (ctx.params.get('type') === 'trajet' ? 'trip' : 'stop');
  let propose: Propose = existing?.propose ?? 'never';
  let area: AreaPick | null = existing?.kind === 'stop' ? { areaId: existing.areaId, op: existing.op, name: existing.name, lat: existing.lat, lon: existing.lon, modes: [] } : null;
  let filter: LineFilter[] | undefined = existing?.kind === 'stop' ? existing.filter : undefined;
  let from: Endpoint | null = existing?.kind === 'trip' ? existing.from : { type: 'here' };
  let to: Endpoint | null = existing?.kind === 'trip' ? existing.to : null;
  let label = existing?.kind === 'trip' ? existing.label ?? '' : '';
  const live = liveRegion();
  const body = h('div', { style: 'display:flex;flex-direction:column;gap:14px' });
  const save = h('button', { type: 'button', class: 'btn btn-primary btn-big btn-block' }, 'Enregistrer le favori');
  const linesBox = h('div');

  const placeOptions = (set: (e: Endpoint) => void, withHere: boolean) => () => [
    ...(withHere ? [{ label: 'Ma position', sub: 'position actuelle', pick: () => set({ type: 'here' }) }] : []),
    ...s.places.map((p) => ({ label: p.label, sub: 'mon lieu', pick: () => set({ type: 'place', placeId: p.id }) })),
  ];

  const sync = (): void => {
    save.disabled = kind === 'stop' ? !area : !from || !to;
  };

  async function loadLines(): Promise<void> {
    linesBox.replaceChildren();
    if (!area) return;
    linesBox.appendChild(h('p', { class: 'small muted' }, 'Chargement des lignes…'));
    try {
      const core = await ctx.core();
      const lines = await core.linesAt(area.areaId);
      if (!area.modes.length && lines.length) {
        area.modes = [...new Set(lines.map((l) => l.mode))];
        const input = body.querySelector<HTMLInputElement>('#fav-arret');
        if (input) input.value = `${displayName(area.name, s.lang)}, ${MODE_TITLE[mainMode(area.modes)].toLowerCase()} (${OP_NAME[area.op]})`;
      }
      const fs = h('fieldset', null, h('legend', { class: 'legend-sm' }, 'Lignes et directions à afficher'));
      const chosen = new Set((filter ?? []).map((f) => `${f.line}|${f.head}`));
      const all = !filter?.length;
      for (const l of lines) {
        const key = `${l.filter.line}|${l.filter.head}`;
        const cb = h('input', { type: 'checkbox', checked: all || chosen.has(key) });
        cb.addEventListener('change', () => {
          const boxes = [...fs.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
          const picked = lines.filter((_, i) => boxes[i]?.checked).map((x) => x.filter);
          filter = picked.length === lines.length || !picked.length ? undefined : picked;
        });
        fs.appendChild(h('label', { class: 'choice compact' }, cb, `${MODE_TITLE[l.mode]} ${l.line} vers ${headText(l.head, s.lang, area.op)}`));
      }
      linesBox.replaceChildren(lines.length ? fs : h('p', { class: 'small muted' }, 'Aucune ligne trouvée pour cet arrêt.'));
    } catch (e) {
      linesBox.replaceChildren(h('p', { class: 'small', role: 'alert' }, e instanceof Error ? e.message : 'Lignes indisponibles'));
    }
  }

  const renderBody = (): void => {
    body.replaceChildren();
    if (kind === 'stop') {
      const value = area ? `${displayName(area.name, s.lang)}${area.modes.length ? `, ${MODE_TITLE[mainMode(area.modes)].toLowerCase()} (${OP_NAME[area.op]})` : ` (${OP_NAME[area.op]})`}` : '';
      body.appendChild(stopPicker(ctx, { id: 'fav-arret', label: 'Arrêt ou gare', value, onPick: (a) => { area = a; filter = undefined; void loadLines(); sync(); } }));
      body.appendChild(linesBox);
      if (area) void loadLines();
    } else {
      const endText = (e: Endpoint | null): string => (e ? endpointText(e, ctx) : '');
      body.appendChild(stopPicker(ctx, { id: 'fav-de', label: 'Départ', value: endText(from), extra: placeOptions((e) => { from = e; sync(); }, true), onPick: (a) => { from = { type: 'area', areaId: a.areaId, op: a.op, name: a.name, lat: a.lat, lon: a.lon }; sync(); } }));
      body.appendChild(stopPicker(ctx, { id: 'fav-vers', label: 'Arrivée', value: endText(to), extra: placeOptions((e) => { to = e; sync(); }, true), onPick: (a) => { to = { type: 'area', areaId: a.areaId, op: a.op, name: a.name, lat: a.lat, lon: a.lon }; sync(); } }));
      const lab = h('input', { id: 'fav-nom', class: 'input', type: 'text', value: label, maxlength: LIMITS.label, placeholder: 'bureau, maison…', autocomplete: 'off' });
      lab.addEventListener('input', () => (label = lab.value));
      body.appendChild(h('div', { class: 'field' }, h('label', { for: 'fav-nom' }, 'Nom affiché (« Pour le bureau : … »), facultatif'), lab));
    }
    body.appendChild(radios<Propose>({ legend: 'Le proposer à l’ouverture', options: PROPOSE_OPTIONS, value: propose, onChange: (v) => (propose = v) }));
    sync();
  };

  save.addEventListener('click', async () => {
    const ids = s.favorites.map((f) => f.id);
    let fav: Favorite;
    if (kind === 'stop') {
      if (!area) return;
      const st: FavoriteStop = { kind: 'stop', id: existing?.id ?? newId('fav', ids), areaId: area.areaId, op: area.op, name: area.name, lat: area.lat, lon: area.lon, propose };
      if (filter?.length) st.filter = filter;
      fav = st;
    } else {
      if (!from || !to) return;
      const tr: FavoriteTrip = { kind: 'trip', id: existing?.id ?? newId('fav', ids), from, to, propose };
      if (label.trim()) tr.label = label.trim();
      fav = tr;
    }
    await ctx.settings.update((x) => ({ ...x, favorites: isNew ? [...x.favorites, fav] : x.favorites.map((f) => (f.id === fav.id ? fav : f)) }));
    live.say('Favori enregistré.');
    ctx.go('#/favoris');
  });

  const kindSeg = segmented<'stop' | 'trip'>({
    legend: 'Type de favori',
    hiddenLegend: true,
    value: kind,
    options: [
      { value: 'stop', label: 'Un arrêt ou une gare' },
      { value: 'trip', label: 'Un trajet de A à B' },
    ],
    onChange: (v) => {
      kind = v;
      renderBody();
    },
  });
  renderBody();
  const extra = existing
    ? h(
        'div',
        { style: 'display:flex;flex-direction:column;gap:10px' },
        s.favorites[0]?.id !== existing.id
          ? h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: async () => { await ctx.settings.update((x) => ({ ...x, favorites: [x.favorites.find((f) => f.id === existing.id)!, ...x.favorites.filter((f) => f.id !== existing.id)] })); ctx.go('#/favoris'); } }, 'Mettre en premier')
          : null,
        h('button', { type: 'button', class: 'btn btn-danger btn-block', onclick: async () => { if (!window.confirm('Supprimer ce favori ?')) return; await ctx.settings.update((x) => ({ ...x, favorites: x.favorites.filter((f) => f.id !== existing.id) })); ctx.go('#/favoris'); } }, 'Supprimer ce favori'),
      )
    : null;
  return h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:14px' },
    header(ctx, isNew ? 'Nouveau favori' : 'Modifier le favori', undefined, { label: 'Favoris', hash: '#/favoris' }),
    isNew ? kindSeg : null,
    body,
    save,
    live.el,
    extra,
  );
}
