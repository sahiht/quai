/**
 * Rechercher un trajet (T2) : « Départ » et « Arrivée » en champs uniques (adresse, gare, arrêt, lieu, récent),
 * trajets classés, étiquetés et expliqués par le cœur (route, PRD § 4), une carte par trajet avec son bouton
 * « Lunettes » (le trajet s'affiche dans les lunettes et devient le trajet suivi), « Garder en favori » (S3),
 * « Enregistrer comme lieu » (M4.6), issue proposée quand il n'y a pas de trajet complet (M5).
 */
import type { Endpoint, FavoriteTrip, Journey, Leg, Mode, Place, PlanResult, Settings } from '../../core/api';
import { LIMITS, newId } from '../../settings';
import { displayName, hhmm, mainMode } from '../../core/util';
import type { AreaSummary, Op } from '../../../../shared/types';
import type { AreaRef } from '../../glasses/types';
import { vehicleOf } from '../../glasses/format';
import { normalizeForSearch } from '../../../../shared/names';
import { header, type PhoneCtx } from '../app';
import { h, ICON } from '../dom';
import { placeField, privacyNote, type FieldChoice } from '../field';
import { glassesButton, showTrip } from '../glasses-link';
import {
  cardPhrase,
  emptyState,
  labelText,
  placeSavedText,
  sameEndpoint,
  shortAddress,
  summaryText,
  T,
  timesText,
  towardsText,
  tripsCount,
  typo,
} from '../text';
import { messageHub, nameShortcuts, nextId } from '../ui';

/** Extrémité choisie dans un champ, avec le texte qu'il affiche. */
export type End =
  | { kind: 'here'; label: string }
  | { kind: 'place'; placeId: string; label: string }
  | { kind: 'area'; area: AreaRef & { modes: Mode[] }; label: string }
  | { kind: 'address'; label: string; lat: number; lon: number; approx?: boolean };

const MODE_TITLE: Record<Mode, string> = { train: 'Train', metro: 'Métro', tram: 'Tram', bus: 'Bus' };

export function toEndpoint(e: End): Endpoint {
  if (e.kind === 'here') return { type: 'here' };
  if (e.kind === 'place') return { type: 'place', placeId: e.placeId };
  if (e.kind === 'address') return e.approx ? { type: 'address', label: e.label, lat: e.lat, lon: e.lon, approx: true } : { type: 'address', label: e.label, lat: e.lat, lon: e.lon };
  const { areaId, op, name, lat, lon } = e.area;
  return { type: 'area', areaId, op, name, lat, lon };
}

const areaOf = (a: Pick<AreaSummary, 'id' | 'op' | 'n' | 'lat' | 'lon' | 'modes'>): AreaRef & { modes: Mode[] } => ({ areaId: a.id, op: a.op, name: a.n, lat: a.lat, lon: a.lon, modes: a.modes });

/** Choix du champ unique → extrémité de la recherche. */
export function endOf(c: FieldChoice): End {
  if (c.kind === 'here') return { kind: 'here', label: 'Ma position' };
  if (c.kind === 'place') return { kind: 'place', placeId: c.place.id, label: c.place.label };
  if (c.kind === 'address') return c.approx ? { kind: 'address', label: c.label, lat: c.lat, lon: c.lon, approx: true } : { kind: 'address', label: c.label, lat: c.lat, lon: c.lon };
  return { kind: 'area', area: areaOf(c.item), label: c.label };
}

/** Adresses récentes (S4) : la plus récente d'abord, 5 au plus, sans doublon. */
export function withRecent(s: Settings, a: { label: string; lat: number; lon: number; approx?: boolean }, at: number): Settings {
  const r = { label: a.label, lat: a.lat, lon: a.lon, at, ...(a.approx ? { approx: true } : {}) };
  return { ...s, recent: [r, ...s.recent.filter((x) => x.label.toLowerCase() !== a.label.toLowerCase())].slice(0, LIMITS.recent) };
}

/**
 * Nom d'un trajet gardé en favori (S3, « nom = la destination ») : l'adresse courte (« Vers Veldstraat 1 »). Un lieu
 * ou une gare n'en ont pas besoin : le cœur prend le nom du lieu, ou celui de la gare dans la langue réglée.
 */
export function favoriteLabelFor(to: End): string | undefined {
  return to.kind === 'address' ? shortAddress(to.label).slice(0, LIMITS.label) : undefined;
}

/** Lieu enregistré depuis une adresse (M4.6) ; un lieu de même nom est mis à jour (même identifiant). */
export function placeFromAddress(s: Settings, name: string, a: { label: string; lat: number; lon: number; approx?: boolean }): { settings: Settings; place: Place } | null {
  const same = s.places.find((p) => normalizeForSearch(p.label) === normalizeForSearch(name));
  if (!same && s.places.length >= LIMITS.places) return null;
  const place: Place = { id: same?.id ?? newId('lieu', s.places.map((p) => p.id)), label: name.slice(0, LIMITS.label), lat: a.lat, lon: a.lon, address: a.label, src: 'address' };
  if (a.approx) place.approx = true;
  return { place, settings: { ...s, places: same ? s.places.map((p) => (p.id === same.id ? place : p)) : [...s.places, place] } };
}

const rides = (j: Journey): Leg[] => j.legs.filter((l) => l.kind === 'ride');

/** Détail sous les étiquettes : « Voie 9 à Bruxelles-Nord, à l’heure » (1.0, inchangé). */
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

function chips(j: Journey): HTMLElement {
  const list = j.legs.map((l) =>
    l.kind === 'walk'
      ? h('span', { class: 'chip walk', html: `${ICON.walk}<span>${typo(`${l.walkMin ?? Math.max(1, Math.round((l.arr - l.dep) / 60_000))} min`)}</span>` })
      : h('span', { class: 'chip', html: `${l.mode === 'train' ? ICON.trainSmall : l.mode === 'bus' ? ICON.busSmall : ICON.tramSmall}<span>${l.mode && l.mode !== 'train' ? `${MODE_TITLE[l.mode]} ${l.line ?? ''}` : vehicleOf(l)}</span>` }),
  );
  return h('span', { class: 'chips' }, list.flatMap((c, k) => (k ? [h('span', { class: 'sep', 'aria-hidden': 'true' }, '›'), c] : [c])));
}

export function searchScreen(ctx: PhoneCtx): HTMLElement {
  const lang = () => ctx.settings.get().lang;
  const hub = messageHub();
  let from: End | null = { kind: 'here', label: 'Ma position' };
  let to: End | null = null;
  let after: number | null = null;
  let result: PlanResult | null = null;
  let failure = '';
  let busy = false;
  let selected = 0;
  let runSeq = 0;

  const status = h('p', { class: 'live', role: 'status', 'aria-live': 'polite' });
  const resultsBox = h('div', { class: 'results-box' });
  const below = h('div', { class: 'below-results' });
  const saveLinkBox = h('div', { class: 'save-link' });

  const remember = (e: End): void => {
    if (e.kind !== 'address') return;
    void ctx.settings.update((s) => withRecent(s, e, ctx.clock.now()));
  };

  const depField = placeField(ctx, {
    id: 'r-depart',
    label: 'Départ',
    placeholder: T.wherePlaceholder,
    value: from.label,
    here: true,
    places: true,
    recent: true,
    onFocus: () => arrField.close(),
    onEdit: () => {
      from = null;
      cleared();
    },
    onPick: (c) => {
      from = endOf(c);
      remember(from);
      if (from.kind === 'here') void hereLabel();
      paintSaveLink();
      void run();
    },
  });
  const arrField = placeField(ctx, {
    id: 'r-arrivee',
    label: 'Arrivée',
    placeholder: T.wherePlaceholder,
    here: true,
    places: true,
    recent: true,
    onFocus: () => depField.close(),
    onEdit: () => {
      to = null;
      cleared();
    },
    onPick: (c) => {
      to = endOf(c);
      remember(to);
      paintSaveLink();
      void run();
    },
  });
  for (const f of [depField, arrField]) f.input.classList.remove('input');

  /** Un champ modifié après un choix : les trajets affichés ne valent plus. */
  function cleared(): void {
    runSeq++;
    busy = false;
    result = null;
    failure = '';
    paintSaveLink();
    paint();
  }
  arrField.input.setAttribute('data-autofocus', '');
  arrField.input.style.fontWeight = '500';

  /** « Ma position, Bruxelles-Central » : gare (ou arrêt) à 300 m au plus. */
  async function hereLabel(): Promise<void> {
    if (from?.kind !== 'here') return;
    const fix = ctx.location.last() ?? (await ctx.location.current(6000));
    if (!fix) return;
    try {
      const near = await (await ctx.core()).nearby(fix.lat, fix.lon, 300, { light: true });
      const st = near.find((n) => mainMode(n.area.modes) === 'train') ?? near[0];
      if (st && from?.kind === 'here') {
        from.label = `Ma position, ${displayName(st.area.n, lang())}`;
        if (document.activeElement !== depField.input && depField.picked()) depField.show(from.label);
      }
    } catch {
      /* sans nom de lieu */
    }
  }

  const swap = h('button', { type: 'button', class: 'swap', 'aria-label': 'Inverser départ et arrivée', html: ICON.swap });
  swap.addEventListener('click', () => {
    [from, to] = [to, from];
    depField.show(from?.label ?? '');
    arrField.show(to?.label ?? '');
    if (!from) depField.search('');
    paintSaveLink();
    void run();
  });

  const timeInput = h('input', { type: 'time', class: 'input', style: 'max-width:140px', 'aria-label': 'Heure de départ' });
  const timeBox = h(
    'div',
    { hidden: true, class: 'time-box' },
    timeInput,
    h('button', { type: 'button', class: 'btn-link', onclick: () => { after = null; timeBox.hidden = true; void run(); } }, 'Maintenant'),
  );
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

  /* --- « Enregistrer comme lieu » (M4.6) : nom, raccourcis, « Enregistrer le lieu » --- */
  const saveTarget = (): 'to' | 'from' | null => (to?.kind === 'address' ? 'to' : from?.kind === 'address' ? 'from' : null);
  const panelId = nextId('lieu');
  const nameInput = h('input', { id: `${panelId}-nom`, class: 'input', type: 'text', maxlength: LIMITS.label, autocomplete: 'off', placeholder: 'Maison, Bureau…' });
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: true }, T.savePlace);
  const panel = h(
    'div',
    { class: 'save-panel box pad', id: panelId },
    h('div', { class: 'field' }, h('label', { for: `${panelId}-nom` }, 'Nom du lieu'), nameInput, nameShortcuts(nameInput)),
    saveBtn,
  );
  nameInput.addEventListener('input', () => (saveBtn.disabled = !nameInput.value.trim()));
  let panelTrigger: { button: HTMLButtonElement; message: HTMLElement } | null = null;
  const closePanel = (): void => {
    panel.remove();
    panelTrigger?.button.setAttribute('aria-expanded', 'false');
  };
  const openPanel = (t: { button: HTMLButtonElement; message: HTMLElement }): void => {
    if (panelTrigger === t && panel.isConnected) return closePanel();
    closePanel();
    panelTrigger = t;
    t.button.setAttribute('aria-expanded', 'true');
    t.message.before(panel);
    hub.say(t.message, '');
    nameInput.focus();
  };
  saveBtn.addEventListener('click', async () => {
    const which = saveTarget();
    const end = which === 'to' ? to : which === 'from' ? from : null;
    const name = nameInput.value.trim();
    if (!end || end.kind !== 'address' || !name || !panelTrigger) return;
    const trigger = panelTrigger;
    const done = placeFromAddress(ctx.settings.get(), name, end);
    if (!done) {
      hub.say(trigger.message, typo(`${LIMITS.places} lieux au plus : supprimes-en un dans Mes lieux.`), true);
      return;
    }
    await ctx.settings.set(done.settings);
    const placeEnd: End = { kind: 'place', placeId: done.place.id, label: done.place.label };
    if (which === 'to') {
      to = placeEnd;
      arrField.show(placeEnd.label);
    } else {
      from = placeEnd;
      depField.show(placeEnd.label);
    }
    nameInput.value = '';
    saveBtn.disabled = true;
    closePanel();
    paintSaveLink();
    paintBelow();
    // Le message reste à l'écran même si son bouton disparaît (adresse désormais enregistrée).
    hub.say(trigger.message, typo(placeSavedText(done.place.label)));
  });

  const linkTrigger = { button: h('button', { type: 'button', class: 'btn-link', 'aria-expanded': 'false', 'aria-controls': panelId }, T.saveAsPlace), message: hub.slot() };
  linkTrigger.button.addEventListener('click', () => openPanel(linkTrigger));
  const bottomTrigger = { button: h('button', { type: 'button', class: 'btn btn-secondary btn-block', 'aria-expanded': 'false', 'aria-controls': panelId }, T.saveAddressAsPlace), message: hub.slot() };
  bottomTrigger.button.addEventListener('click', () => openPanel(bottomTrigger));

  function paintSaveLink(): void {
    const show = !!saveTarget();
    if (!show && panelTrigger === linkTrigger) closePanel();
    const open = show && panelTrigger === linkTrigger && panel.isConnected;
    saveLinkBox.replaceChildren(...(show ? [linkTrigger.button] : []), ...(open ? [panel] : []), linkTrigger.message);
  }

  /* --- « Garder en favori » (S3) --- */
  const keepBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, T.keepFavorite);
  const keepMsg = hub.slot();
  keepBtn.addEventListener('click', async () => {
    if (!from || !to) return;
    const fromE = toEndpoint(from);
    const toE = toEndpoint(to);
    const s = ctx.settings.get();
    if (s.favorites.some((f) => f.kind === 'trip' && sameEndpoint(f.from, fromE) && sameEndpoint(f.to, toE))) return hub.say(keepMsg, T.favExists);
    if (s.favorites.length >= LIMITS.favorites) return hub.say(keepMsg, typo(`${LIMITS.favorites} favoris au plus : supprimes-en un dans Mes favoris.`), true);
    const fav: FavoriteTrip = { kind: 'trip', id: newId('fav', s.favorites.map((f) => f.id)), from: fromE, to: toE, propose: 'never' };
    const label = favoriteLabelFor(to);
    if (label) fav.label = label;
    await ctx.settings.update((x) => ({ ...x, favorites: [...x.favorites, fav] }));
    hub.say(keepMsg, T.favAdded);
  });

  function paintBelow(): void {
    const any = !!result?.journeys.length;
    const show = any && !!saveTarget();
    if (!show && panelTrigger === bottomTrigger) closePanel();
    const open = show && panelTrigger === bottomTrigger && panel.isConnected;
    below.replaceChildren(...(any ? [keepBtn] : []), keepMsg, ...(show ? [bottomTrigger.button] : []), ...(open ? [panel] : []), bottomTrigger.message);
  }

  /* --- Cartes --- */
  function select(i: number, focus = false): void {
    selected = i;
    resultsBox.querySelectorAll<HTMLElement>('.result').forEach((el, k) => {
      el.classList.toggle('on', k === i);
      const radio = el.querySelector<HTMLElement>('[role="radio"]');
      if (!radio) return;
      radio.setAttribute('aria-checked', k === i ? 'true' : 'false');
      radio.tabIndex = k === i ? 0 : -1;
      if (k === i && focus) radio.focus();
    });
  }

  function card(j: Journey, i: number, r: PlanResult): HTMLElement {
    const now = ctx.clock.now();
    const label = labelText(j);
    const phrase = cardPhrase(j, r);
    const radio = h(
      'div',
      { role: 'radio', class: 'card', 'aria-checked': i === selected ? 'true' : 'false', tabindex: i === selected ? '0' : '-1' },
      h('span', { class: 'tagrow' }, label ? h('span', { class: 'tag' }, label) : null),
      h('span', { class: 'r1' }, h('span', { class: 'time' }, timesText(j, now)), h('span', { class: 'dur' }, typo(summaryText(j)))),
      chips(j),
      h('span', { class: 'det' }, typo(rideDetail(j, lang()))),
      phrase ? h('span', { class: 'why' }, typo(phrase)) : null,
    );
    radio.addEventListener('click', () => select(i));
    const { button, message } = glassesButton(hub, `Afficher ${label || 'ce trajet'} dans les lunettes`, () => {
      select(i);
      return showTrip(ctx, { title: towardsText(toEndpoint(to!), ctx.settings.get()), from: toEndpoint(from!), to: toEndpoint(to!), result: r, index: i });
    });
    return h('div', { class: `result${i === selected ? ' on' : ''}` }, radio, button, message);
  }

  function paint(): void {
    resultsBox.replaceChildren();
    if (!from || !to) {
      status.textContent = '';
      paintBelow();
      return;
    }
    const fromName = from.kind === 'here' ? from.label.replace(/^Ma position, /, '') : from.label;
    const t = after ?? ctx.clock.now();
    resultsBox.append(
      h(
        'div',
        { class: 'res-head' },
        h('div', { class: 'res-title' }, h('h2', null, `${fromName} → ${to.label}`), h('span', { class: 'small muted' }, after ? `départs dès ${hhmm(t)}` : `dès ${hhmm(t)}`)),
        h('button', { type: 'button', class: 'btn-link', onclick: () => { timeBox.hidden = !timeBox.hidden; if (!timeBox.hidden) timeInput.focus(); } }, 'Changer l’heure'),
      ),
      timeBox,
      status,
    );
    if (busy) status.textContent = 'Recherche…';
    else if (failure) {
      status.textContent = typo(failure);
      status.classList.add('err');
    } else if (result?.journeys.length) {
      status.classList.remove('err');
      status.textContent = tripsCount(result.journeys.length);
      const group = h('div', { class: 'results', role: 'radiogroup', 'aria-label': 'Trajets proposés' }, result.journeys.map((j, i) => card(j, i, result!)));
      group.addEventListener('keydown', (e) => {
        const n = result?.journeys.length ?? 0;
        if (!(e.target instanceof HTMLElement) || e.target.getAttribute('role') !== 'radio' || !n) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') select((selected + 1) % n, true);
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') select((selected - 1 + n) % n, true);
        else if (e.key === ' ' || e.key === 'Enter') select(selected, true);
        else return;
        e.preventDefault();
      });
      resultsBox.append(group);
    } else if (result) {
      status.classList.remove('err');
      const empty = emptyState(result, toEndpoint(to), ctx.settings.get(), { web: ctx.web });
      status.textContent = typo(empty.text);
      if (empty.kind === 'station') {
        const st = empty.station;
        resultsBox.append(
          h('button', {
            type: 'button',
            class: 'btn btn-secondary btn-block',
            onclick: () => {
              const op = st.areaId.split(':')[0] as Op;
              to = { kind: 'area', area: { areaId: st.areaId, op, name: st.name, lat: st.lat, lon: st.lon, modes: ['train'] }, label: displayName(st.name, lang()) };
              arrField.show(to.label);
              paintSaveLink();
              void run();
            },
          }, empty.button),
        );
      }
    }
    paintBelow();
  }

  async function run(): Promise<void> {
    if (!from || !to) {
      result = null;
      paint();
      return;
    }
    const my = ++runSeq;
    busy = true;
    failure = '';
    result = null;
    hub.clear();
    paint();
    try {
      const c = await ctx.core();
      const t = after ?? ctx.clock.now();
      const needHere = from.kind === 'here' || to.kind === 'here';
      const fix = needHere ? ctx.location.last() ?? (await ctx.location.current(8000)) : ctx.location.last();
      const r = await c.route(toEndpoint(from), toEndpoint(to), t, ctx.settings.get(), fix ? { lat: fix.lat, lon: fix.lon } : null);
      if (my !== runSeq) return;
      result = r;
      selected = 0;
    } catch (e) {
      if (my !== runSeq) return;
      failure = e instanceof Error && e.message ? e.message : 'Recherche impossible pour l’instant.';
    }
    busy = false;
    paint();
  }

  // Liens directs : #/recherche?q=Gand (saisie), ?de=ici&vers=sncb:8892007 (recherche lancée ; lieux et arrêts).
  void (async () => {
    const q = ctx.params.get('q');
    const vers = ctx.params.get('vers');
    const de = ctx.params.get('de');
    void hereLabel();
    if (q && !vers) arrField.search(q);
    if (!vers) return;
    try {
      const c = await ctx.core();
      const resolve = async (id: string): Promise<End> => {
        if (id === 'ici') return { kind: 'here', label: 'Ma position' };
        const place = ctx.settings.get().places.find((p) => p.id === id);
        if (place) return { kind: 'place', placeId: place.id, label: place.label };
        const b = await c.board(id, { limit: 1 });
        return { kind: 'area', area: areaOf(b.area), label: displayName(b.area.n, lang()) };
      };
      to = await resolve(vers);
      if (de) from = await resolve(de);
      depField.show(from?.label ?? '');
      arrField.show(to.label);
      paintSaveLink();
      await hereLabel();
      await run();
    } catch (e) {
      status.textContent = typo(e instanceof Error ? e.message : 'Arrêt introuvable');
      resultsBox.replaceChildren(status);
    }
  })();

  paintSaveLink();
  return h(
    'div',
    { class: 'screen search' },
    header(ctx, 'Rechercher un trajet', undefined, { label: 'Accueil', hash: '#/' }),
    h(
      'div',
      { class: 'fields' },
      h(
        'div',
        { class: 'od' },
        h('div', { class: 'end' }, depField.label, h('div', { class: 'end-row', html: ICON.pin }, depField.input)),
        h('div', { class: 'end' }, arrField.label, arrField.input),
        swap,
      ),
      depField.list,
      depField.status,
      arrField.list,
      arrField.status,
      saveLinkBox,
      privacyNote(),
    ),
    resultsBox,
    below,
    h('p', { class: 'foot' }, 'Recherche sur SNCB, STIB, De Lijn et TEC'),
  );
}
