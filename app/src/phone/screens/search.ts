/**
 * Rechercher un trajet (T2) : « Départ » et « Arrivée » en champs uniques (adresse, gare, arrêt, lieu, récent),
 * trajets classés et étiquetés par le cœur (route, PRD-1.2.1 § 1), une carte par trajet (PRD-1.2.1 § 7.2 : nom
 * affiché, ligne « moyens », phrase qui dit pourquoi il passe devant ou derrière) avec son bouton « Lunettes » (le
 * trajet s'affiche dans les lunettes et devient le trajet suivi), « Jour férié : horaires du dimanche » au-dessus des
 * résultats (§ 5), « Garder en favori » (un lieu depuis « Ma position », sinon un trajet fixe, PRD-1.2 § 2.2), issue
 * proposée quand il n'y a pas de trajet complet (M5).
 */
import type { Endpoint, Favorite, FavoriteTrip, Journey, Leg, Mode, PlanResult, Settings } from '../../core/api';
import { placeOf, placesOf } from '../../core/favorites';
import { LIMITS, newId } from '../../settings';
import { displayName, distanceM, hhmm, mainMode } from '../../core/util';
import type { AreaSummary, Op } from '../../../../shared/types';
import type { AreaRef } from '../../glasses/types';
import { vehicleOf } from '../../glasses/format';
import { header, type PhoneCtx } from '../app';
import { h, ICON } from '../dom';
import { placeField, privacyNote, withRecent, type FieldChoice } from '../field';
import { glassesButton, showTrip } from '../glasses-link';
import { cardPhrase, cardTitle, emptyState, holidayLine, limitText, meansLine, sameEndpoint, shortAddress, summaryText, T, timesText, towardsText, tripsCount, typo } from '../text';
import { messageHub } from '../ui';
import { makePlace, type Spot } from './places';

/** Extrémité choisie dans un champ, avec le texte qu'il affiche. */
export type End =
  | { kind: 'here'; label: string }
  | { kind: 'place'; placeId: string; label: string }
  | { kind: 'area'; area: AreaRef & { modes: Mode[] }; label: string }
  | { kind: 'address'; label: string; lat: number; lon: number; approx?: boolean };

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

/** Adresses récentes (S4) : partagées avec Quai Web, dans field.ts. */
export { withRecent };

/**
 * Nom affiché d'un trajet fixe gardé en favori (S3, « nom = la destination ») : l'adresse courte (« Vers Veldstraat
 * 1 »). Un lieu ou une gare n'en ont pas besoin : le cœur prend le nom du lieu, ou celui de la gare dans la langue
 * réglée.
 */
export function favoriteLabelFor(to: End): string | undefined {
  return to.kind === 'address' ? shortAddress(to.label).slice(0, LIMITS.label) : undefined;
}

/** Même endroit qu'un lieu déjà gardé : même adresse, même arrêt, ou à moins de 30 m. */
const SAME_PLACE_M = 30;

/** Endroit d'un lieu gardé depuis une recherche (adresse normalisée, ou arrêt « Près de Gand-Saint-Pierre »). */
function spotOfEnd(e: End): Spot | null {
  if (e.kind === 'address') return e.approx ? { lat: e.lat, lon: e.lon, src: 'address', address: e.label, approx: true } : { lat: e.lat, lon: e.lon, src: 'address', address: e.label };
  if (e.kind === 'area') return { lat: e.area.lat, lon: e.area.lon, src: 'stop', address: `Près de ${e.label}`.slice(0, LIMITS.address), areaId: e.area.areaId };
  return null;
}

/**
 * « Garder en favori » (PRD-1.2 § 2.2, CA-2.4) : depuis « Ma position », un lieu (nom : l'adresse courte ou l'arrêt,
 * « Veldstraat 1 ») ; sinon un trajet fixe (nom affiché : l'adresse courte d'une adresse d'arrivée). Rend les réglages
 * avec le nouveau favori, 'exists' s'il y est déjà, 'full' à la limite des 32 favoris, null si rien n'est à garder.
 */
export function keepFavorite(s: Settings, from: End, to: End, now = Date.now()): { settings: Settings; fav: Favorite } | 'exists' | 'full' | null {
  const ids = s.favorites.map((f) => f.id);
  let fav: Favorite;
  if (from.kind === 'here') {
    if (to.kind === 'place') return 'exists';
    const spot = spotOfEnd(to);
    if (!spot) return null;
    const same = placesOf(s).some(
      (p) => (spot.areaId && p.areaId === spot.areaId) || (spot.src === 'address' && p.address?.toLowerCase() === spot.address?.toLowerCase()) || distanceM(p, spot) < SAME_PLACE_M,
    );
    if (same) return 'exists';
    fav = makePlace(newId('lieu', ids, now), to.kind === 'address' ? shortAddress(to.label) : to.label, spot, 'never');
  } else {
    const fromE = toEndpoint(from);
    const toE = toEndpoint(to);
    if (s.favorites.some((f) => f.kind === 'trip' && sameEndpoint(f.from, fromE) && sameEndpoint(f.to, toE))) return 'exists';
    const trip: FavoriteTrip = { kind: 'trip', id: newId('fav', ids, now), from: fromE, to: toE, propose: 'never' };
    const label = favoriteLabelFor(to);
    if (label) trip.label = label;
    fav = trip;
  }
  if (s.favorites.length >= LIMITS.favorites) return 'full';
  return { fav, settings: { ...s, favorites: [...s.favorites, fav] } };
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
    // Heure effacée dans le sélecteur (« Effacer ») : Number('') vaut 0, ce n'est pas minuit.
    if (!timeInput.value || !Number.isFinite(hh)) return;
    // Heure belge : on part de l'heure actuelle (à la minute) et on décale de la différence demandée.
    const now = ctx.clock.now();
    const [ch, cm] = hhmm(now).split(':').map(Number);
    let t = now - (now % 60_000) + ((hh - ch) * 60 + ((mm || 0) - cm)) * 60_000;
    if (t < now - 3_600_000) t += 86_400_000;
    after = t;
    void run();
  });

  /* --- « Garder en favori » : un lieu depuis « Ma position », sinon un trajet fixe --- */
  const keepBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, T.keepFavorite);
  const keepMsg = hub.slot();
  keepBtn.addEventListener('click', async () => {
    if (!from || !to) return;
    const done = keepFavorite(ctx.settings.get(), from, to, ctx.clock.now());
    if (done === 'exists') return hub.say(keepMsg, T.favExists);
    if (done === 'full') return hub.say(keepMsg, typo(limitText(LIMITS.favorites)), true);
    if (!done) return;
    await ctx.settings.update((x) => ({ ...x, favorites: [...x.favorites.filter((f) => f.id !== done.fav.id), done.fav] }));
    hub.say(keepMsg, T.favAdded);
  });

  function paintBelow(): void {
    const any = !!result?.journeys.length;
    below.replaceChildren(...(any ? [keepBtn] : []), keepMsg);
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

  /**
   * Carte d'un trajet (PRD-1.2.1 § 7.2) : nom affiché, heures et durée, ligne « moyens » (« bus W + S1, à pied 4 + 5
   * min » ; noms des lignes en nœuds texte, données publiées, jamais du HTML), départ du premier véhicule, phrase.
   */
  function card(j: Journey, i: number, r: PlanResult): HTMLElement {
    const now = ctx.clock.now();
    const label = cardTitle(j, r);
    const means = meansLine(j);
    const phrase = cardPhrase(j, r, ctx.settings.get().maxWalkMin);
    const radio = h(
      'div',
      { role: 'radio', class: 'card', 'aria-checked': i === selected ? 'true' : 'false', tabindex: i === selected ? '0' : '-1' },
      h('span', { class: 'tagrow' }, label ? h('span', { class: 'tag' }, label) : null),
      h('span', { class: 'r1' }, h('span', { class: 'time' }, timesText(j, now)), h('span', { class: 'dur' }, typo(summaryText(j)))),
      means ? h('span', { class: 'means' }, typo(means)) : null,
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
    // Jour férié (§ 5) : sous l'heure de la recherche, au-dessus des résultats, quand un trajet proposé part ce jour-là.
    const holiday = busy || failure ? '' : holidayLine(result);
    resultsBox.append(
      h(
        'div',
        { class: 'res-head' },
        h(
          'div',
          { class: 'res-title' },
          h('h2', null, `${fromName} → ${to.label}`),
          h('span', { class: 'small muted' }, after ? `départs dès ${hhmm(t)}` : `dès ${hhmm(t)}`),
          holiday ? h('span', { class: 'small muted holiday' }, holiday) : null,
        ),
        h('button', { type: 'button', class: 'btn-link', onclick: () => { timeBox.hidden = !timeBox.hidden; if (!timeBox.hidden) timeInput.focus(); } }, 'Changer l’heure'),
      ),
      timeBox,
      status,
    );
    if (busy) {
      status.textContent = 'Recherche…';
      status.classList.remove('err');
    } else if (failure) {
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

  // Liens directs : #/recherche?q=Gand (saisie), ?de=ici&vers=sncb:8892007 (recherche lancée ; lieux favoris et arrêts).
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
        const place = placeOf(ctx.settings.get(), id);
        if (place) return { kind: 'place', placeId: place.id, label: place.label };
        const b = await c.board(id, { limit: 1 });
        return { kind: 'area', area: areaOf(b.area), label: displayName(b.area.n, lang()) };
      };
      to = await resolve(vers);
      if (de) from = await resolve(de);
      depField.show(from?.label ?? '');
      arrField.show(to.label);
      await hereLabel();
      await run();
    } catch (e) {
      status.textContent = typo(e instanceof Error ? e.message : 'Arrêt introuvable');
      resultsBox.replaceChildren(status);
    }
  })();

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
      privacyNote(),
    ),
    resultsBox,
    below,
    h('p', { class: 'foot' }, 'Recherche sur SNCB, STIB, De Lijn et TEC'),
  );
}
