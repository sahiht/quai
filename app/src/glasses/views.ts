/**
 * Modèles de vue des écrans des lunettes (SPEC § 5.1, maquettes Visite1-3). Fonctions pures :
 * données du cœur + réglages + heure → GlassesView. Testables sans SDK.
 */
import type { Board, Departure, Favorite, Journey, Leg, NameLang, NearbyItem, Settings, Suggestion } from '../core/api';
import { OP_NAME, areaLabel, displayName, hhmm, lineLabel, minutesUntil } from '../core/util';
import type { AreaRef, GlassesView, Intent, Item, Route, TopLine } from './types';
import {
  HINTS,
  LAST_MARK,
  NB,
  NOTE_NO_RT,
  NOTE_PLANNED,
  atLabel,
  boardTitle,
  dayWord,
  distanceText,
  durationText,
  endpointName,
  headText,
  legsSummary,
  minutesText,
  nextText,
  plannedMark,
  platformText,
  stopsCount,
  towards,
  trainCell,
  transfersText,
  vehicleLong,
  vehicleOf,
  withDay,
} from './format';

export interface ViewCtx {
  now: number;
  settings: Settings;
  /** Horaires périmés (dataFreshness, ok = false) : message affiché à la place des listes vides. */
  stale?: string;
  /** Quai Web : les réglages sont dans l'onglet Réglages de la page, pas dans l'appli du téléphone. */
  web?: boolean;
}

const lang = (c: ViewCtx): NameLang => c.settings.lang;
const mp = (c: ViewCtx): boolean => c.settings.display.markPlanned;
const hints = (c: ViewCtx, text: string): string => (c.settings.display.gestureHints ? text : '');

function base(screen: GlassesView['screen'], layout: GlassesView['layout'], title: string, ctx: ViewCtx): GlassesView {
  return { screen, layout, title, clock: hhmm(ctx.now), items: [], hints: '' };
}

/* ------------------------------ Messages ------------------------------ */

export function messageView(
  title: string,
  lines: string[],
  ctx: ViewCtx,
  opts: { hints?: string; tap?: Intent; screen?: GlassesView['screen'] } = {},
): GlassesView {
  const v = base(opts.screen ?? 'message', 'message', title, ctx);
  v.items = lines.map((a) => ({ a }));
  v.hints = opts.hints ? hints(ctx, opts.hints) : '';
  if (opts.tap) v.tap = opts.tap;
  return v;
}

export function loadingView(title: string, text: string, ctx: ViewCtx): GlassesView {
  return messageView(title, [text], ctx, { hints: HINTS.message });
}

export function errorView(title: string, text: string, ctx: ViewCtx): GlassesView {
  return messageView(title, [text], ctx, { hints: HINTS.retry, tap: { kind: 'retry' } });
}

export function firstRunView(ctx: ViewCtx): GlassesView {
  if (ctx.web) {
    return messageView(
      'Quai',
      ['Bienvenue dans Quai !', `Termine les réglages dans l’onglet Réglages${NB}:`, 'position et langue des noms, en deux gestes.'],
      ctx,
      { hints: HINTS.firstRunWeb, tap: { kind: 'continue' } },
    );
  }
  return messageView(
    'Quai',
    [
      'Bienvenue dans Quai !',
      'Termine les réglages sur le téléphone :',
      'appli Even Realities, onglet Even Hub, Quai.',
      'Position et langue des noms, en deux gestes.',
    ],
    ctx,
    { hints: HINTS.firstRun, tap: { kind: 'continue' } },
  );
}

export function notConfiguredView(ctx: ViewCtx): GlassesView {
  return messageView(
    'Quai',
    ['Quai n’est pas encore configuré.', 'Adresses des horaires et du relais absentes :', 'voir le README, « npm run configure ».'],
    ctx,
    { hints: `double toucher${NB}: quitter` },
  );
}

/* ------------------------------ Accueil ------------------------------ */

export interface HomeData {
  /** undefined = en cours de calcul ; null = rien à proposer. */
  suggestion?: Suggestion | null;
  nearbyCount?: number;
  /** Lieu proche pour la ligne de contexte (« Près de Bruxelles-Nord »). */
  near?: string;
  /** Message de données périmées (dataFreshness, ok = false) : ligne forte. */
  stale?: string;
  /** Avertissement non bloquant (dataFreshness, ok = true avec message) : ligne discrète. */
  notice?: string;
}

/** Route ouverte par un favori. */
export function favoriteRoute(f: Favorite, settings: Settings, journey?: Journey): Route {
  if (f.kind === 'stop') return f.filter?.length ? { screen: 'board', areaId: f.areaId, filter: f.filter } : { screen: 'board', areaId: f.areaId };
  const label = f.label ?? endpointName(f.to, settings, settings.lang);
  if (journey) return { screen: 'steps', journey, label, leaveAt0: journey.leaveAt };
  if (f.from.type === 'area' && f.to.type === 'area' && f.from.op === 'sncb' && f.to.op === 'sncb') {
    return { screen: 'trip', from: areaRefOf(f.from), to: areaRefOf(f.to) };
  }
  return { screen: 'journeys', from: f.from, to: f.to, label };
}

export function areaRefOf(e: { areaId: string; op: AreaRef['op']; name: AreaRef['name']; lat: number; lon: number }): AreaRef {
  return { areaId: e.areaId, op: e.op, name: e.name, lat: e.lat, lon: e.lon };
}

/** Route ouverte par la suggestion d'ouverture. */
export function suggestionRoute(s: Suggestion, settings: Settings): Route | undefined {
  const fav = settings.favorites.find((f) => f.id === s.favoriteId);
  if (s.kind === 'favoriteStop') {
    if (fav) return favoriteRoute(fav, settings);
    if (s.board) return { screen: 'board', areaId: s.board.area.id };
    return undefined;
  }
  if (fav) return favoriteRoute(fav, settings, s.journey);
  if (s.journey) return { screen: 'steps', journey: s.journey, label: 'destination', leaveAt0: s.journey.leaveAt };
  return undefined;
}

export function homeView(d: HomeData, ctx: ViewCtx): GlassesView {
  const v = base('home', 'menu', 'Quai', ctx);
  const s = d.suggestion;
  if (s) {
    const route = suggestionRoute(s, ctx.settings);
    v.items.push({ a: s.title, b2: s.subtitle, action: route ? { kind: 'open', route } : undefined });
  }
  v.items.push({ a: 'Autour de moi', c: stopsCount(d.nearbyCount), action: { kind: 'open', route: { screen: 'nearby' } } });
  v.items.push({ a: 'Mes favoris', c: String(ctx.settings.favorites.length), action: { kind: 'open', route: { screen: 'favorites' } } });
  v.items.push({ a: 'Aller à…', action: { kind: 'open', route: { screen: 'places' } } });
  if (d.stale) v.top = { text: d.stale, strong: true };
  else if (d.notice) v.top = { text: d.notice };
  else if (!s && d.near) v.top = { text: `Près de ${d.near}` };
  v.hints = hints(ctx, HINTS.home);
  return v;
}

/* ------------------------------ Autour de moi ------------------------------ */

export function nearbyView(list: NearbyItem[], ctx: ViewCtx): GlassesView {
  const radius = ctx.settings.display.radiusM;
  if (!list.length) {
    return messageView('Autour de moi', [`Aucun arrêt dans un rayon de ${radius}${NB}m`], ctx, { hints: HINTS.message });
  }
  const v = base('nearby', 'nearby', 'Autour de moi', ctx);
  let planned = false;
  for (const it of list) {
    if (it.next && !it.next.rt && !it.next.cancelled) planned = true;
    v.items.push({
      a: areaLabel(it.area, lang(ctx)),
      b: distanceText(it.distanceM),
      c: nextText(it.next, ctx.now, mp(ctx)),
      cTail: lastMark(it.next),
      action: { kind: 'open', route: { screen: 'board', areaId: it.area.id } },
    });
  }
  v.note = ctx.stale ?? (planned && mp(ctx) ? NOTE_PLANNED : undefined);
  v.reserveNote = true;
  v.hints = hints(ctx, HINTS.nearby);
  return v;
}

/* ------------------------------ Tableau d'un arrêt ------------------------------ */

export function boardView(b: Board, ctx: ViewCtx, opts: { isFavorite: boolean; limit?: number }): GlassesView {
  const train = b.area.modes.includes('train') && b.area.op === 'sncb';
  const v = base('board', train ? 'boardTrain' : 'board', boardTitle(b.area, lang(ctx)), ctx);
  const deps = b.departures.slice(0, opts.limit ?? ctx.settings.display.depsPerStop);
  const fav: Intent = { kind: 'toggleFavoriteStop' };
  let planned = false;
  let msg: string | undefined;
  for (const d of deps) {
    if (!d.rt && !d.cancelled) planned = true;
    if (d.msg && !msg) msg = d.msg;
    // heure d'un autre jour (trains, ou bus au-delà d'une heure) : « demain, » devant la destination
    const head = train || minutesUntil(d.est, ctx.now) >= 60 ? withDay(headText(d.head, lang(ctx), d.op), train ? d.sched : d.est, ctx.now) : headText(d.head, lang(ctx), d.op);
    v.items.push(
      train
        ? { a: d.line, b: head, c: trainCell(d, mp(ctx)), action: fav }
        : { a: lineLabel(d.mode, d.line), b: head, bTail: lastMark(d), c: minutesText(d, ctx.now, mp(ctx)), action: fav },
    );
  }
  if (!deps.length) v.items.push({ a: ctx.stale ?? 'Aucun départ dans les prochaines heures', action: fav });
  if (msg) v.top = { text: `! ${msg}`, strong: true };
  if (b.rtErrors.length) v.note = NOTE_NO_RT;
  else if (planned && mp(ctx)) v.note = NOTE_PLANNED;
  v.reserveNote = true;
  v.hints = hints(ctx, opts.isFavorite ? HINTS.boardFav : HINTS.board);
  v.tap = fav;
  return v;
}

/* ------------------------------ Mes favoris ------------------------------ */

/** Prochain départ d'un favori ; `last` : dernier passage annoncé de la ligne (« , dernier » s'il tient). */
export interface FavoriteNext { text: string; planned: boolean; last?: boolean }

/** « , dernier » pour le dernier passage annoncé d'une ligne (jamais pour un départ supprimé). */
export function lastMark(d: Pick<Departure, 'last' | 'cancelled'> | Pick<Leg, 'last' | 'cancelled'> | undefined): string | undefined {
  return d?.last && !d.cancelled ? LAST_MARK : undefined;
}

export function favoriteLabel(f: Favorite, settings: Settings): string {
  if (f.kind === 'stop') return `${displayName(f.name, settings.lang)} (${OP_NAME[f.op]})`;
  return `${endpointName(f.from, settings, settings.lang)} ▶ ${endpointName(f.to, settings, settings.lang)}`;
}

export function favoritesView(next: Record<string, FavoriteNext | null | undefined>, ctx: ViewCtx): GlassesView {
  const favs = ctx.settings.favorites;
  if (!favs.length) {
    const where = ctx.web ? 'Ajoute-les dans l’onglet Réglages.' : 'Ajoute-les dans Quai, sur le téléphone.';
    return messageView('Mes favoris', ['Aucun favori pour l’instant.', where], ctx, { hints: HINTS.message });
  }
  const v = base('favorites', 'menu', 'Mes favoris', ctx);
  let planned = false;
  for (const f of favs) {
    const n = next[f.id];
    if (n?.planned) planned = true;
    v.items.push({ a: favoriteLabel(f, ctx.settings), c: n === undefined ? '…' : n ? n.text : '', cTail: n?.last ? LAST_MARK : undefined, action: { kind: 'open', route: favoriteRoute(f, ctx.settings) } });
  }
  v.note = ctx.stale ?? (planned && mp(ctx) ? NOTE_PLANNED : undefined);
  v.reserveNote = true;
  v.hints = hints(ctx, HINTS.favorites);
  return v;
}

/* ------------------------------ Trains A ▶ B ------------------------------ */

const rides = (j: Journey): Leg[] => j.legs.filter((l) => l.kind === 'ride');
const firstRideIndex = (j: Journey): number => j.legs.findIndex((l) => l.kind === 'ride');

export function tripTitle(from: AreaRef, to: AreaRef, l: NameLang): string {
  return `${displayName(from.name, l)} ▶ ${displayName(to.name, l)}`;
}

export function tripView(route: Extract<Route, { screen: 'trip' }>, journeys: Journey[], ctx: ViewCtx): GlassesView {
  const title = tripTitle(route.from, route.to, lang(ctx));
  if (!journeys.length) {
    return messageView(title, ctx.stale ? [ctx.stale] : ['Aucun train direct ni avec une correspondance', 'dans les prochaines heures.'], ctx, { hints: HINTS.message });
  }
  const v = base('trip', 'trip', title, ctx);
  let planned = false;
  for (const j of journeys) {
    const rs = rides(j);
    const first = rs[0];
    const last = rs[rs.length - 1];
    if (!first || !last) continue;
    if (!j.rt) planned = true;
    const delay = Math.max(0, ...rs.map((r) => r.delayMin ?? 0));
    const cancelled = rs.some((r) => r.cancelled);
    const plat = platformText(first.platform, first.newPlatform);
    v.items.push({
      a: `${plannedMark(j.rt, mp(ctx))}${hhmm(first.schedDep)}`,
      b: withDay(`${plat ? plat + ', ' : ''}arrivée ${hhmm(last.arr)}${j.transfers ? ', ' + transfersText(j.transfers) : ''}`, first.schedDep, ctx.now),
      c: cancelled ? 'SUPPRIMÉ' : delay > 0 ? `+${delay} min` : j.rt ? 'à l’heure' : '',
      action: { kind: 'open', route: { screen: 'train', journey: j, leg: firstRideIndex(j), trip: { from: route.from, to: route.to } } },
    });
  }
  v.note = planned && mp(ctx) ? NOTE_PLANNED : undefined;
  v.reserveNote = true;
  v.hints = hints(ctx, HINTS.trip);
  return v;
}

/* ------------------------------ Aller à… ------------------------------ */

export function placesView(summary: Record<string, string | undefined>, ctx: ViewCtx): GlassesView {
  const v = base('places', 'menu', 'Aller à…', ctx);
  for (const p of ctx.settings.places) {
    v.items.push({
      a: p.label,
      c: summary[p.id] ?? '…',
      action: { kind: 'open', route: { screen: 'journeys', from: { type: 'here' }, to: { type: 'place', placeId: p.id }, label: p.label } },
    });
  }
  if (ctx.web) {
    // Quai Web : l'onglet Réglages est sur la même page, le toucher l'ouvre directement.
    if (!ctx.settings.places.length) {
      v.items.push({ a: 'Aucun lieu enregistré', c: 'dans Réglages', action: { kind: 'phone', hash: '#/lieux/nouveau', text: 'Ajoute Maison ou Bureau dans l’onglet Réglages' } });
    }
    v.items.push({ a: 'Autre lieu', c: 'dans Réglages', action: { kind: 'phone', hash: '#/recherche', text: 'Cherche un autre lieu dans l’onglet Réglages' } });
  } else {
    if (!ctx.settings.places.length) {
      v.items.push({ a: 'Aucun lieu enregistré', c: 'sur le téléphone', action: { kind: 'toast', text: 'Ajoute Maison ou Bureau dans Quai, sur le téléphone' } });
    }
    v.items.push({ a: 'Autre lieu', c: 'sur le téléphone', action: { kind: 'toast', text: 'Cherche un autre lieu dans Quai, sur le téléphone' } });
  }
  if (ctx.stale) v.note = ctx.stale;
  v.hints = hints(ctx, HINTS.places);
  return v;
}

/** Résumé d'un lieu dans « Aller à… » : « arrivée 18:43 », « 9 min à pied », « ici ». */
export function placeSummary(journeys: Journey[] | null, now: number): string {
  if (!journeys) return '';
  const j = journeys[0];
  if (!j) return 'aucun trajet';
  if (!j.legs.some((l) => l.kind === 'ride')) {
    const m = Math.round((j.arr - j.dep) / 60_000);
    return m <= 2 ? 'ici' : `${m} min à pied`;
  }
  const day = dayWord(j.arr, now);
  return j.arr > now ? `arrivée ${day ? day + ' ' : ''}${hhmm(j.arr)}` : '';
}

/** Destination demandée alors qu'on y est déjà (moins de 100 m, même seuil que le cœur). */
export function alreadyThereView(label: string, ctx: ViewCtx): GlassesView {
  return messageView(towards(label), [`Tu es déjà ${atLabel(label)}.`], ctx, { hints: HINTS.message });
}

/* ------------------------------ Propositions de trajet ------------------------------ */

export function journeysView(route: Extract<Route, { screen: 'journeys' }>, journeys: Journey[], ctx: ViewCtx): GlassesView {
  const title = `${towards(route.label)}, départ maintenant`;
  if (!journeys.length) return messageView(towards(route.label), [ctx.stale ?? 'Aucun trajet trouvé pour l’instant.'], ctx, { hints: HINTS.message });
  const v = base('journeys', 'journeys', title, ctx);
  for (const j of journeys.slice(0, 3)) {
    const start = j.legs.some((l) => l.kind === 'ride') ? j.leaveAt : j.dep;
    v.items.push({
      a: `${plannedMark(j.rt, mp(ctx))}${dayWord(start, ctx.now) ? dayWord(start, ctx.now) + ' ' : ''}${hhmm(start)} ▶ ${hhmm(j.arr)}`,
      c: `${durationText((j.arr - start) / 60_000)}, ${transfersText(j.transfers)}`,
      b2: legsSummary(j),
      action: { kind: 'open', route: { screen: 'steps', journey: j, label: route.label, leaveAt0: j.leaveAt } },
    });
  }
  v.hints = hints(ctx, HINTS.journeys);
  return v;
}

/* ------------------------------ Étapes ------------------------------ */

/** Heure de départ à pied affichée : figée une fois partie (maquette Visite1, étape 3). */
export function shownLeaveAt(route: Extract<Route, { screen: 'steps' }>, j: Journey, now: number): number {
  return now >= route.leaveAt0 ? Math.min(route.leaveAt0, j.leaveAt) : j.leaveAt;
}

function areaName(n: { name: { fr: string; nl: string; l?: 'fr' | 'nl' } }, l: NameLang): string {
  return displayName(n.name, l);
}

export function stepsView(route: Extract<Route, { screen: 'steps' }>, j: Journey, ctx: ViewCtx): GlassesView {
  const leave = shownLeaveAt(route, j, ctx.now);
  const hasRide = j.legs.some((l) => l.kind === 'ride');
  const start = hasRide ? leave : j.dep;
  const day = dayWord(start, ctx.now);
  const v = base('steps', 'steps', `${towards(route.label)}${NB}: ${day ? day + ' ' : ''}${hhmm(start)} ▶ ${hhmm(j.arr)}`, ctx);
  const l = lang(ctx);
  j.legs.forEach((leg, i) => {
    const last = i === j.legs.length - 1;
    if (leg.kind === 'walk') {
      const walkMin = leg.walkMin ?? Math.max(1, Math.round((leg.arr - leg.dep) / 60_000));
      if (i === 0 && !last) {
        const next = j.legs.slice(1).find((x) => x.kind === 'ride');
        const dest = next?.mode === 'train' ? 'la gare' : 'l’arrêt';
        const walking = ctx.now >= leave && ctx.now < leg.arr;
        v.items.push({ a: hhmm(leave), b: `Partir à pied vers ${dest}`, c: walking ? 'en cours' : `${walkMin} min` });
      } else if (last) {
        v.items.push({ a: hhmm(leg.arr), b: `Arrivée ${atLabel(route.label)}, à pied`, c: `${walkMin} min` });
      } else {
        v.items.push({ a: hhmm(leg.dep), b: `À pied vers ${areaName(leg.to, l)}`, c: `${walkMin} min` });
      }
      return;
    }
    const head = leg.head ? ` vers ${headText(leg.head, l, leg.op)}` : '';
    const p = leg.newPlatform || leg.platform;
    const plat = leg.mode === 'train' && p ? `, voie ${p}` : '';
    const delay = leg.delayMin ?? 0;
    v.items.push({
      a: `${plannedMark(leg.rt ?? false, mp(ctx))}${hhmm(leg.schedDep)}`,
      b: `${vehicleOf(leg)}${head}${plat}`,
      bTail: lastMark(leg),
      c: leg.cancelled ? 'SUPPRIMÉ' : delay > 0 ? `+${delay} min` : '',
      action: { kind: 'open', route: { screen: 'train', journey: j, leg: i, label: route.label } },
    });
    v.items.push({ a: hhmm(leg.arr), b: `${last ? 'Arrivée à' : 'Descendre à'} ${areaName(leg.to, l)}` });
  });
  const alert = j.alerts[0];
  if (alert) v.top = { text: alert.text, strong: true };
  v.hints = hints(ctx, HINTS.steps);
  return v;
}

/* ------------------------------ Dans le train ------------------------------ */

export function trainTitle(leg: Leg, l: NameLang, now?: number): string {
  const head = leg.head ? ` vers ${headText(leg.head, l, leg.op)}` : '';
  const delay = leg.cancelled ? ', SUPPRIMÉ' : leg.delayMin && leg.delayMin > 0 ? `, +${leg.delayMin} min` : '';
  const day = now === undefined ? '' : dayWord(leg.schedDep, now);
  return `${vehicleOf(leg)}${head}${delay}${day ? `, ${day}` : ''}`;
}

export function trainView(j: Journey, legIndex: number, ctx: ViewCtx): GlassesView {
  const leg = j.legs[legIndex];
  if (!leg || leg.kind !== 'ride') return messageView('Dans le train', ['Trajet introuvable.'], ctx, { hints: HINTS.message });
  const v = base('train', 'train', trainTitle(leg, lang(ctx), ctx.now), ctx);
  const stops = leg.stops?.length
    ? leg.stops
    : [
        { name: leg.from.name, sched: leg.schedDep, est: leg.dep, platform: leg.newPlatform || leg.platform },
        { name: leg.to.name, sched: leg.schedArr, est: leg.arr },
      ];
  const mark = plannedMark(leg.rt ?? false, mp(ctx));
  let next = -1;
  stops.forEach((s, k) => {
    const lastStop = k === stops.length - 1;
    const passed = s.est <= ctx.now && !lastStop;
    let c = '';
    if (lastStop) c = 'descente';
    else if (passed) c = 'passé';
    else if (next < 0) {
      next = k;
      c = k === 0 ? platformText(s.platform ?? leg.platform, k === 0 ? leg.newPlatform : undefined) || 'prochain' : 'prochain';
    }
    if (lastStop && next < 0) next = k;
    v.items.push({ a: displayName(s.name, lang(ctx)), b: `${mark}${hhmm(s.est)}`, c });
  });
  v.initialSel = Math.max(0, next);
  v.initialTop = Math.max(0, next - 1);
  v.hints = hints(ctx, HINTS.train);
  return v;
}

/* ------------------------------ Arrivée ------------------------------ */

export function arrivalView(stationName: string, arrivalAt: number, deps: Departure[], ctx: ViewCtx): GlassesView {
  const v = base('arrival', 'arrival', `Arrivée à ${stationName}`, ctx);
  const m = minutesUntil(arrivalAt, ctx.now);
  const top: TopLine = { text: m > 0 ? `Dans ${m} min. Ensuite, devant la gare${NB}:` : `Ensuite, devant la gare${NB}:`, strong: true };
  v.top = top;
  const save: Intent = { kind: 'saveTrip' };
  const shown = deps.slice(0, 4);
  for (const d of shown) {
    const head = headText(d.head, lang(ctx), d.op);
    v.items.push({ a: vehicleLong(d.mode, d.line), b: minutesUntil(d.est, ctx.now) >= 60 ? withDay(head, d.est, ctx.now) : head, bTail: lastMark(d), c: minutesText(d, ctx.now, mp(ctx)), action: save });
  }
  if (!shown.length) v.items.push({ a: 'Aucun départ devant la gare', action: save });
  if (mp(ctx) && shown.some((d) => !d.rt && !d.cancelled)) v.note = NOTE_PLANNED;
  v.reserveNote = true;
  v.tap = save;
  v.hints = hints(ctx, HINTS.arrival);
  return v;
}

/** Les items sélectionnables : tous sauf sur les écrans de message. */
export function selectable(v: GlassesView): boolean {
  return v.layout !== 'message';
}

/** Intention d'un toucher sur l'élément `sel`. */
export function tapIntent(v: GlassesView, sel: number): Intent | undefined {
  const it: Item | undefined = v.items[sel];
  return (selectable(v) ? it?.action : undefined) ?? v.tap;
}
