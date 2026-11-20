/**
 * 1.2.10 « Y aller » : oracle des textes du guidage (PRD-1.2.10 § 3.2 et § 3.3), écrit d'après le PRD seul, sans le
 * code de l'appli. Les textes attendus se calculent sur le trajet guidé (FollowedTrip.journey, clé quai.trip) : les
 * scénarios restent exacts quel que soit le trajet que le classement du cœur choisit sur les fixtures.
 *
 * Comparaison : le journal QUAI_SCREEN remplace les espaces insécables par des espaces ; les apostrophes droites et
 * typographiques sont tenues pour égales (le PRD écrit « jusqu'à », l'appli « jusqu’à »).
 */

/** Ce que l'oracle lit du trajet guidé (sous-ensemble de Journey et Leg, app/src/core/api.ts). */
export interface OLeg {
  kind: 'walk' | 'ride';
  from: { name: { fr: string }; lat: number; lon: number };
  to: { name: { fr: string }; lat: number; lon: number };
  dep: number;
  arr: number;
  schedDep: number;
  schedArr: number;
  walkMin?: number;
  op?: string;
  mode?: string;
  line?: string;
  cat?: string;
  head?: { fr: string };
  platform?: string;
  newPlatform?: string;
  rt?: boolean;
  delayMin?: number;
  cancelled?: boolean;
  stops?: { name: { fr: string }; sched: number; est: number; platform?: string }[];
  /** 1.2.5 : pluie prévue pendant cette marche (1.3.1, B19 : « pluie prévue » sur « Partir maintenant ») */
  rain?: boolean;
}
export interface OJourney {
  id: string;
  legs: OLeg[];
  dep: number;
  arr: number;
  leaveAt: number;
  rt: boolean;
}

export type Want = string | RegExp;

/** Aides des écrans du guidage (PRD § 3.2, § 3.3, § 5, § 3.1) ; 1.3.1 : useSpec('1.3.1'). */
export const HINTS: { moment: string; arrived: string; stepsGo: string; stepsGuided: string; stopsAlight: string } = {
  moment: 'toucher : effacer   appui long : arrêter',
  arrived: 'toucher : terminer',
  stepsGo: '△▽ étapes   toucher : y aller   double : retour',
  /** trajet guidé : arbitrage de l'intégrateur (toucher rouvre le guidage), le PRD § 5 disait « △▽ étapes   double : retour » */
  stepsGuided: '△▽ étapes   toucher : guidage   double : retour',
  stopsAlight: '△▽ arrêts   toucher : j’y descends   double : retour',
};

/** Menu de l'appui long (PRD § 3.4) : identifiants 1 et 2 ; 1.3.1 (B10, E4) : useSpec('1.3.1'). */
export const MENU: string[] = ['Arrêter le guidage', 'Voir tout le trajet'];

/**
 * 1.3.1 : attentes de la spécification jouée (run-sim.ts, option `--spec`). Avant la 1.3.1, les textes des PRD 1.2.10
 * et 1.3.0 ; à partir de la 1.3.1 (docs/v1.3.1/PRD-1.3.1.md § 2, § 3, § 12 ; B10 à B19 ; C), les fonctions de cet oracle
 * rendent les textes de la 1.3.1 (`SPEC.v131`) : « masquer », menu de l'appui long, « Tram 3 dans ~1 min », « IC 07:42
 * +2 », « très juste » seulement quand le moteur le dit, « ensuite : … → Gare du Nord », « Si tu le rates : tram 3 à … ».
 */
export const SPEC = { v131: false };
export function useSpec(spec: string): void {
  const v = spec.split('.').map(Number);
  SPEC.v131 = v[0] > 1 || (v[0] === 1 && (v[1] > 3 || (v[1] === 3 && (v[2] ?? 0) >= 1)));
  if (!SPEC.v131) return;
  HINTS.moment = T131.guideHints;
  HINTS.stopsAlight = T131.stopsHints;
  MENU.splice(0, MENU.length, ...T131.menu);
}
export const TOASTS = { stopped: 'Guidage arrêté', followed: 'Trajet suivi' } as const;

/** Normalisation de comparaison : espaces insécables → espaces, apostrophe droite → typographique. */
export const norm = (t: string | undefined): string => (t ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/'/g, '’');
export const matches = (got: string | undefined, want: Want): boolean => (typeof want === 'string' ? norm(got) === norm(want) : want.test(norm(got)));
export const showWant = (w: Want): string => (typeof w === 'string' ? `« ${w} »` : String(w));

/** Heure belge (UTC+1 en novembre ; les fixtures sont le 10 et le 11/11/2026). */
export function hm(ms: number): string {
  const d = new Date(ms + 3_600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Véhicule tel que les écrans l'écrivent (contrat VehicleRef) : « IC », « bus 6 », « tram 3 », « métro 2 », « bus SNCB ». */
export function vehicle(l: Pick<OLeg, 'op' | 'mode' | 'line' | 'cat'>): string {
  if (l.op === 'sncb' && l.mode === 'bus') return 'bus SNCB';
  if (l.mode === 'train') return l.cat ?? 'train';
  const word = l.mode === 'metro' ? 'métro' : l.mode === 'tram' ? 'tram' : 'bus';
  return `${word} ${l.line ?? ''}`.trim();
}
const isTrain = (l: OLeg) => l.mode === 'train' && l.op === 'sncb';
/** Heure d'un départ, « ~ » sans temps réel (PRD § 3.2, « leave »). */
const time = (ms: number, rt: boolean | undefined) => `${rt ? '' : '~'}${hm(ms)}`;
const minutesFloor = (ms: number) => Math.floor(ms / 60_000);

export const rides = (j: OJourney): number[] => j.legs.map((l, i) => (l.kind === 'ride' ? i : -1)).filter((i) => i >= 0);
const nextRide = (j: OJourney, from: number): number => j.legs.findIndex((l, i) => i >= from && l.kind === 'ride');

/** « jusqu'à l'arrêt Monument Gramme » ; train : « jusqu'à la gare de Namur » ; dernière marche : « jusqu'à {titre} ». */
export function walkTarget(j: OJourney, walkLeg: number, title: string): string {
  const r = nextRide(j, walkLeg + 1);
  if (r < 0) return title;
  const l = j.legs[r];
  return isTrain(l) ? `la gare de ${l.from.name.fr}` : `l’arrêt ${l.from.name.fr}`;
}

/** Moment « leave » (PRD § 3.2) : 3 lignes, 4 avec « Si tu le rates » (marge ≤ 1 min). */
export function leaveLines(j: OJourney, title: string, now: number): Want[] {
  const w = j.legs[0].kind === 'walk' ? 0 : -1;
  const walkMin = w === 0 ? (j.legs[0].walkMin ?? Math.max(1, Math.round((j.legs[0].arr - j.legs[0].dep) / 60_000))) : 0;
  const r = nextRide(j, 0);
  const out: Want[] = ['Partir maintenant', `${walkMin} min à pied jusqu’à ${walkTarget(j, 0, title)}`];
  if (r < 0) return out;
  const l = j.legs[r];
  if (SPEC.v131) {
    // 1.3.1 (A4, P4) : « très juste » seulement quand le moteur le dit : marge exacte (secondes comprises) d'une minute
    // ou moins ; à 30 s de la frontière, les deux formes. B13 (U6) : un train en retard « IC 07:42 +2 ».
    const exact = (l.dep - now) / 60_000 - walkMin;
    const base = vehicleWhen(l);
    if (exact <= 0.5) out.push(`${base}, très juste`, RATES);
    else if (exact <= 1.5) out.push(new RegExp(`^${esc(base)}(, très juste)?$`));
    else out.push(base);
    return out;
  }
  const margin = minutesFloor(l.dep - now) - walkMin;
  const base = `${vehicle(l)} à ${time(l.dep, l.rt)}`;
  // marge à la minute près selon l'instant exact du calcul : les deux formes sont admises à la frontière
  if (margin <= 0) out.push(`${base}, très juste`, /^Si tu le rates : arrivée \d\d:\d\d(, \d+ min plus tard)?$/);
  else if (margin === 1 || margin === 2) out.push(new RegExp(`^${esc(base)}(, très juste)?$`));
  else out.push(base);
  return out;
}

/** Panneau du moment « board » (PRD § 3.2) : petit mot en haut, grand chiffre. */
export function boardSign(l: OLeg): { label: string; value: string } {
  if (isTrain(l)) {
    const p = l.newPlatform ?? l.platform;
    return p ? { label: 'voie', value: p } : { label: 'train', value: l.cat ?? 'IC' };
  }
  return { label: l.mode === 'metro' ? 'métro' : l.mode === 'tram' ? 'tram' : 'bus', value: l.line ?? '' };
}

/** « descente dans 4 arrêts » ; un seul : « descente au prochain arrêt » (phrase de la 1.2.5). */
export const stopsPhrase = (n: number): string => (n <= 1 ? 'descente au prochain arrêt' : `descente dans ${n} arrêts`);
/** Arrêts entre la montée et la descente (la descente comprise). */
export const stopsToAlight = (l: OLeg): number => Math.max(1, (l.stops?.length ?? 2) - 1);

/**
 * Moment « board » : bus, tram, métro : « dans 1 min » (au-delà de 10 min : « à 07:12 » ; « imminent » seulement en
 * temps réel) ; train : « IC à 07:30 » ; pâle « vers {terminus} », pâle « descente dans n arrêts » ; correspondance
 * en gare : « 3 min à pied jusqu'au quai, marge 6 min » ; voie modifiée : « voie modifiée ».
 */
export function boardLines(j: OJourney, leg: number, now: number): Want[] {
  if (SPEC.v131) return boardLines131(j, leg, now);
  const l = j.legs[leg];
  const out: Want[] = [];
  const changed = !!l.newPlatform && !!l.platform && l.newPlatform !== l.platform;
  const p = l.newPlatform ?? l.platform;
  // train : « IC à 07:30, voie 3 » ; voie modifiée : « IC à 07:30, voie 6 ! » (arbitrage du contrôle usager)
  if (isTrain(l)) out.push(`${l.cat ?? 'train'} à ${time(l.dep, l.rt)}${p ? `, voie ${p}${changed ? ' !' : ''}` : ''}`);
  else {
    const m = minutesFloor(l.dep - now);
    if (m > 10) out.push(`à ${time(l.dep, l.rt)}`);
    else {
      // minutes arrondies vers le bas : à une minute près selon l'instant du rendu ; « imminent » en temps réel seulement
      const mins = [Math.max(0, m - 1), m, m + 1].join('|');
      out.push(new RegExp(`^dans ${l.rt ? '' : '~'}(${mins}) min$${l.rt && m <= 1 ? '|^imminent$' : ''}`));
    }
  }
  if (l.head) out.push(`vers ${l.head.fr}`);
  const prev = j.legs[leg - 1];
  // correspondance : « 3 min à pied jusqu'au quai, marge 6 min » (train) ; « 2 min à pied jusqu'à l'arrêt, très juste » ;
  // trois lignes au plus (PRD § 3.9) : elle prend la place de « descente dans n arrêts »
  if (prev && prev.kind === 'walk' && leg > 1) out.push(isTrain(l) ? /^\d+ min à pied jusqu’au quai, (marge \d+ min|très juste)$/ : /^\d+ min à pied jusqu’à l’arrêt, (marge \d+ min|très juste)$/);
  else out.push(stopsPhrase(stopsToAlight(l)));
  return out;
}

/** Moment « platform » : « Voie modifiée » ; « IC à 07:30, voie 6 au lieu de 4 ». */
export function platformLines(l: OLeg): Want[] {
  // 1.3.1 (B13, U6) : un train en retard « IC 07:42 +2, voie 6 au lieu de 4 »
  if (SPEC.v131) return ['Voie modifiée', `${vehicleWhen(l)}, voie ${l.newPlatform} au lieu de ${l.platform}`];
  return ['Voie modifiée', `${vehicle(l)} à ${time(l.dep, l.rt)}, voie ${l.newPlatform} au lieu de ${l.platform}`];
}

/** Moment « nextStop » (train, 10 min ou plus à bord) : « Prochain arrêt : Louvain » ; « descente dans 3 arrêts, à Bruxelles-Central ». */
export function nextStopLines(l: OLeg, nextIdx: number): Want[] {
  const stops = l.stops ?? [];
  const left = stops.length - 1 - nextIdx;
  return [`Prochain arrêt : ${stops[nextIdx]?.name.fr ?? '?'}`, `descente dans ${left + 1} arrêts, à ${l.to.name.fr}`];
}

/** Ligne « ensuite : … » d'une descente. */
export function thenLine(j: OJourney, leg: number): Want | null {
  if (SPEC.v131) return thenLine131(j, leg);
  const n = j.legs[leg + 1];
  if (!n) return null;
  if (n.kind === 'walk') {
    const r = j.legs[leg + 2];
    if (!r) return `ensuite : ${n.walkMin ?? Math.max(1, Math.round((n.arr - n.dep) / 60_000))} min à pied`;
    const p = r.newPlatform ?? r.platform;
    return isTrain(r) && p ? `ensuite : voie ${p}, ${vehicle(r)} à ${time(r.dep, r.rt)}` : `ensuite : ${vehicle(r)} à ${time(r.dep, r.rt)}`;
  }
  const p = n.newPlatform ?? n.platform;
  return isTrain(n) && p ? `ensuite : voie ${p}, ${vehicle(n)} à ${time(n.dep, n.rt)}` : `ensuite : ${vehicle(n)} à ${time(n.dep, n.rt)}`;
}

/** Moment « alight » : « Descends au prochain arrêt » ; « Gare des Guillemins, 07:20 » ; pâle « ensuite : … ». */
export function alightLines(j: OJourney, leg: number): Want[] {
  const l = j.legs[leg];
  const t = thenLine(j, leg);
  return ['Descends au prochain arrêt', `${l.to.name.fr}, ${time(l.arr, l.rt)}`, ...(t ? [t] : [])];
}

/** Moment « arrived » : « Tu y es » ; pâle « {titre}, 08:54, à l'heure » / « 3 min de retard » / « 2 min d'avance ». */
export function arrivedLines(title: string, arr: number, sched: number): Want[] {
  const d = Math.round((arr - sched) / 60_000);
  const diff = d === 0 ? 'à l’heure' : d > 0 ? `${d} min de retard` : `${-d} min d’avance`;
  return ['Tu y es', `${title}, ${hm(arr)}, ${diff}`];
}

/** Moment « replan » (véhicule raté) : « Ton IC de 07:30 est parti » ; « Nouveau trajet : IC 08:02, voie 3 » ; pâle « arrivée 09:27, 33 min plus tard ». */
export function replanMissedLines(lost: OLeg, next: OJourney | null, oldArr: number): Want[] {
  // heure perdue : départ estimé (07:44) ou prévu (07:42) : le PRD ne tranche pas, les deux sont admises
  const lostRe = new RegExp(`^Ton ${esc(vehicle(lost))} de (${esc(hm(lost.dep))}|${esc(hm(lost.schedDep))}) est parti$`);
  if (!next) return [lostRe, 'Pas d’autre trajet trouvé'];
  const r = next.legs[nextRide(next, 0)];
  const p = r?.newPlatform ?? r?.platform;
  if (SPEC.v131) {
    // 1.3.1 (B12, L4) : « Nouveau trajet : IC à 08:42, voie 5 » ; B13 : un train en retard « IC 08:42 +3, voie 5 »
    const first = r ? new RegExp(`^Nouveau trajet : ${esc(vehicleWhen(r))}${isTrain(r) && p ? `, voie ${esc(p)}` : ''}$`) : /^Nouveau trajet : /;
    return [lostRe, first, `arrivée ${hm(next.arr)}, ${Math.round((next.arr - oldArr) / 60_000)} min plus tard`];
  }
  const first = r ? new RegExp(`^Nouveau trajet : ${esc(vehicle(r))} ~?${esc(hm(r.dep))}${isTrain(r) && p ? `, voie ${esc(p)}` : ''}$`) : /^Nouveau trajet : /;
  return [lostRe, first, `arrivée ${hm(next.arr)}, ${Math.round((next.arr - oldArr) / 60_000)} min plus tard`];
}

/** Moment « passed » : « Tu as passé Bruxelles-Central » ; « Descends à Bruxelles-Midi, 08:31 » ; pâle « nouveau trajet : arrivée 09:06 ». */
export function passedLines(passed: string, getOff: string, at: number, rt: boolean | undefined, newArr?: number): Want[] {
  return [`Tu as passé ${passed}`, `Descends à ${getOff}, ${time(at, rt)}`, ...(newArr !== undefined ? [`nouveau trajet : arrivée ${hm(newArr)}`] : [])];
}

/** Chaîne de « Où tu en es » (§ 3.3) : la marche de départ s'il y en a une, puis chaque véhicule ; ● fait, ◎ en cours, ○ à venir. */
export function chainLabels(j: OJourney): string[] {
  return [...(j.legs[0]?.kind === 'walk' ? ['à pied'] : []), ...rides(j).map((i) => vehicle(j.legs[i]))];
}
export function chainLine(j: OJourney, nowIdx: number): Want {
  const labels = chainLabels(j);
  const full = labels.map((x, i) => `${i < nowIdx ? '●' : i === nowIdx ? '◎' : '○'} ${x}`).join(' ─ ');
  // trop longue : « … » au milieu (PRD § 3.3) ; l'écran décide du point de coupe, au pixel
  return labels.length > 4 ? new RegExp(`^${esc(full.split(' ─ ')[0])} ─ .*….* ─ ${esc(full.split(' ─ ').at(-1)!)}$|^${esc(full)}$`) : full;
}

/** « Où tu en es » à pied (§ 3.3). */
export function whereWalkLines(j: OJourney, walkLeg: number, title: string, nowIdx: number): Want[] {
  const r = nextRide(j, walkLeg + 1);
  const l = r >= 0 ? j.legs[r] : null;
  const p = l ? (l.newPlatform ?? l.platform) : undefined;
  const toward: Want = !l ? title : isTrain(l) && p ? new RegExp(`^À pied vers (la voie ${esc(p)}|la gare de ${esc(l.from.name.fr)})$`) : `l’arrêt du ${vehicle(l)}`;
  return [
    chainLine(j, nowIdx),
    typeof toward === 'string' ? `À pied vers ${toward}` : toward,
    /^((\d+ m|\d+,\d km), )?\d+ min$/,
    ...(l ? [new RegExp(`^${esc(vehicle(l))} à ${esc(time(l.dep, l.rt))}, (marge \\d+ min|très juste)$`)] : []),
    `arrivée ${time(j.arr, j.rt)}`,
  ];
}

/** « Où tu en es » à l'arrêt ou à la gare (§ 3.3). */
export function whereWaitLines(j: OJourney, leg: number, nowIdx: number): Want[] {
  const l = j.legs[leg];
  const p = l.newPlatform ?? l.platform;
  return [
    chainLine(j, nowIdx),
    isTrain(l) ? `À la gare de ${l.from.name.fr}` : `À l’arrêt ${l.from.name.fr}`,
    new RegExp(`^${esc(vehicle(l))} (dans ~?\\d+ min|imminent|à ~?\\d\\d:\\d\\d), vers ${esc(l.head?.fr ?? '')}$`),
    // voie modifiée : « voie 6 ! » comme sur les autres écrans
    ...(isTrain(l) && p ? [new RegExp(`^voie ${esc(p)}${l.newPlatform && l.platform && l.newPlatform !== l.platform ? '( !)?' : ''}$`)] : []),
    `arrivée ${time(j.arr, j.rt)}`,
  ];
}

/** « Où tu en es » à bord (§ 3.3) : progression 1.2.5, prochain arrêt, descente, arrivée (genre trip). */
export function whereRideLines(j: OJourney, leg: number, nextIdx: number, nowIdx: number, kind: 'trip' | 'ride'): Want[] {
  const l = j.legs[leg];
  const stops = l.stops ?? [];
  const n = stops[nextIdx];
  return [
    chainLine(j, nowIdx),
    // le prochain arrêt est la descente : « c'est ta descente » (arbitrage du contrôle usager)
    stops.length - 1 - nextIdx === 0 ? /^[●◎○─…]+ (  )?(c’est ta descente|descente au prochain arrêt)$/ : new RegExp(`^[●◎○─…]+ (  )?${esc(stopsPhrase(stops.length - 1 - nextIdx + 1))}$|^[●◎○─…]+$`),
    ...(n ? [`Prochain arrêt : ${n.name.fr}, ${time(n.est, l.rt)}`] : []),
    `descente : ${l.to.name.fr}, ${time(l.arr, l.rt)}`,
    ...(kind === 'trip' ? [`arrivée ${time(j.arr, j.rt)}`] : []),
  ];
}

/** Aucun tiret long ni moyen, guillemets français seulement (PRD § 1.6). */
export function typographyIssues(lines: string[]): string[] {
  const bad: string[] = [];
  for (const l of lines) {
    if (/[\u2013\u2014]/.test(l)) bad.push(`tiret long ou moyen : « ${l} »`);
    if (/"/.test(l)) bad.push(`guillemet droit : « ${l} »`);
    if (/presse le pas|pas besoin de courir/i.test(l)) bad.push(`conseil au lieu d’une heure (PRD § 1.3) : « ${l} »`);
    // 1.3.1 (PRD-1.3.1 § 7) : jamais d'apostrophe droite affichée (noms des données compris)
    if (SPEC.v131 && /'/.test(l)) bad.push(`apostrophe droite (PRD-1.3.1 § 7) : « ${l} »`);
  }
  return bad;
}

/**
 * Compare les lignes d'un écran aux lignes attendues, dans l'ordre (les lignes en plus, comme l'aide, sont permises
 * après). Rend la liste des écarts, lisible : quel rang, quel texte attendu, quel texte vu.
 */
export function compareLines(got: string[], want: Want[]): string[] {
  const bad: string[] = [];
  want.forEach((w, i) => {
    if (!matches(got[i], w)) bad.push(`ligne ${i + 1} : ${showWant(w)} attendu, vu « ${norm(got[i])} »`);
  });
  return bad;
}

/* ------------------------------ 1.3.1 : textes exacts du PRD (docs/v1.3.1/PRD-1.3.1.md, § 12) ------------------------------ */

/**
 * Textes de la 1.3.1, tels que le PRD les écrit (comparés avec `matches` : espaces insécables et apostrophes
 * typographiques tenues pour égales ; l'apostrophe droite affichée est vérifiée à part, `typographyIssues`).
 */
export const T131 = {
  /** § 2 : aide de l'écran du guidage */
  guideHints: 'toucher : masquer   appui long : arrêter',
  /** § 1 : écran calme d'un guidage, au plus pâle, en bas au centre */
  dots: '· · ·',
  /** § 3, § 12 : « Où tu en es » */
  whereTitle: 'Guidage en cours',
  /** § 12 : « j'y descends » */
  rideNote: 'Quai te dit quand descendre',
  /** § 6 : ligne d'action de la liste des arrêts d'un départ, et ses aides */
  stopsAction: '▶ Me guider jusqu’à cet arrêt',
  stopsHints: '△▽ arrêts   double : retour',
  /** B10 (E4) : menu de l'appui long, « Arrêter le guidage » en dernier */
  menu: ['Voir tout le trajet', 'Voir les arrêts', 'Arrêter le guidage'],
  /** A6 (P3) */
  uturn: 'Fais demi-tour',
  /** B19 (I5) : 4e ligne pâle de « Partir maintenant » */
  rain: 'pluie prévue',
  /** C (L3) : vérification au départ et en route */
  noPosition: 'Pas de position : Quai suit l’horaire',
  lostPale: 'Quai suit l’horaire en attendant',
  /** C (L6) : aides des listes, le même geste dit pareil */
  listDepartures: '△▽ choisir   toucher : départs   double : retour',
  listLines: '△▽ choisir   toucher : parcours   double : retour',
  /** C (L7) : messages ★ des lunettes */
  starLine: '★ Ajoutée à tes lignes',
  starAlready: '★ Déjà dans tes favoris',
  starTrip: '★ Trajet ajouté à tes favoris',
  /** § 5 : conseil du test de l'écran, résultat « Head-Up » (tête levée) */
  headUp:
    'Pour voir les messages sans bouger la tête : dans l’appli Even, règle l’angle de l’affichage Head-Up à 0, en regardant un peu vers le bas pendant le réglage. L’écran restera allumé quand tu regardes devant toi ; la batterie des lunettes s’use un peu plus vite.',
  /** § 8 : ordre de l'accueil (lunettes, téléphone, Quai Web) */
  home: ['Autour de moi', 'Favoris', 'Gares de train', 'Lignes de bus, tram, métro', 'Arrêts de bus, tram, métro'],
  /** C (L2) : aide du réglage « Me guider » (téléphone) */
  guideSetting:
    'Les lunettes ne montrent que trois petits points et t’écrivent seulement quand tu dois agir : partir, tourner, monter, descendre. Éteint : ton trajet est suivi sans rien afficher tout seul.',
};

/** « Si tu le rates : arrivée 09:34, 30 min plus tard » (règle 1.2.5) ; sans l'écart si la ligne ne tient pas. */
export const RATES = /^Si tu le rates : arrivée \d\d:\d\d(, \d+ min plus tard)?$/;

/** Retard d'un train en temps réel, en minutes (0 : à l'heure, pas de temps réel, ou pas un train). */
export function trainLate(l: OLeg): number {
  if (!isTrain(l) || !l.rt) return 0;
  const d = Math.round((l.dep - l.schedDep) / 60_000);
  return d >= 1 ? d : 0;
}

/**
 * 1.3.1 (B13, U6) : « IC 07:42 +2 » pour un train en retard (comme en gare), sinon « IC à 07:44 », « bus 6 à ~07:12 ».
 */
export function vehicleWhen(l: OLeg): string {
  const d = trainLate(l);
  return d ? `${vehicle(l)} ${hm(l.schedDep)} +${d}` : `${vehicle(l)} à ${time(l.dep, l.rt)}`;
}

/** 1.3.1 (B12, L4) : le véhicule en tête du message « monter » : « Tram 3 », « Bus 6 », « Métro 2 », « Bus SNCB », « IC ». */
export const vehicleCap = (l: Pick<OLeg, 'op' | 'mode' | 'line' | 'cat'>): string => {
  const v = vehicle(l);
  return v.charAt(0).toUpperCase() + v.slice(1);
};

/** Marge d'une correspondance (minutes) : départ du véhicule moins l'arrivée de la marche qui y mène. */
export function connectionMargin(j: OJourney, leg: number): number | undefined {
  const l = j.legs[leg];
  const w = j.legs[leg - 1];
  if (!l || l.kind !== 'ride' || !w || w.kind !== 'walk' || leg < 2) return undefined;
  return Math.floor((l.dep - w.arr) / 60_000);
}

/**
 * 1.3.1 : moment « board » (« monter », § 12, B12, B13, B16) : « Tram 3 dans ~1 min » (au-delà de 10 min « Tram 3 à
 * ~07:12 », temps réel « Tram 3 imminent ») ; train « IC 07:42 +2, voie 6 ! » ; pâle « vers Churchill » ; correspondance
 * « 2 min à pied → Gare du Nord, très juste » si le nom tient, sinon « 2 min à pied jusqu'à l'arrêt, très juste »
 * (« jusqu'au quai » pour un train) ; sinon « descente dans 5 arrêts ». La 4e ligne « Si tu le rates : tram 3 à 08:51 »
 * (B16) : `boardMissedLine`.
 */
export function boardLines131(j: OJourney, leg: number, now: number): Want[] {
  const l = j.legs[leg];
  const out: Want[] = [];
  const changed = !!l.newPlatform && !!l.platform && l.newPlatform !== l.platform;
  const p = l.newPlatform ?? l.platform;
  if (isTrain(l)) out.push(`${vehicleWhen(l)}${p ? `, voie ${p}${changed ? ' !' : ''}` : ''}`);
  else {
    const V = esc(vehicleCap(l));
    const m = minutesFloor(l.dep - now);
    if (m > 11) out.push(new RegExp(`^${V} à ${l.rt ? '' : '~'}${esc(hm(l.dep))}$`));
    else {
      const mins = [Math.max(0, m - 1), m, m + 1].join('|');
      const at = m >= 10 ? `|${V} à ${l.rt ? '' : '~'}${esc(hm(l.dep))}` : '';
      out.push(new RegExp(`^(${V} dans ${l.rt ? '' : '~'}(${mins}) min${l.rt && m <= 1 ? `|${V} imminent` : ''}${at})$`));
    }
  }
  if (l.head) out.push(`vers ${l.head.fr}`);
  const prev = j.legs[leg - 1];
  if (prev && prev.kind === 'walk' && leg > 1) {
    const where = `(→ ${esc(l.from.name.fr)}|jusqu’${isTrain(l) ? 'au quai' : 'à l’arrêt'})`;
    out.push(new RegExp(`^\\d+ min à pied ${where}, (marge \\d+ min|très juste)$`));
  } else out.push(stopsPhrase(stopsToAlight(l)));
  return out;
}

/** 1.3.1 (B16, U4) : 4e ligne pâle du « monter » d'une correspondance très juste : « Si tu le rates : tram 3 à 08:51 ». */
export function boardMissedLine(l: OLeg): RegExp {
  return new RegExp(`^Si tu le rates : ${esc(vehicle(l))} à ~?\\d\\d:\\d\\d$`);
}

/**
 * 1.3.1 : « ensuite : … » d'une descente. Marche puis véhicule : « ensuite : 7 min à pied → Flagey » (§ 4) ; correspondance
 * très juste (B16, marge d'une minute ou moins) : « ensuite : tram 3 à ~08:44, très juste » (ou la marche avec « , très
 * juste ») ; dernière marche : inchangée (« ensuite : 9 min à pied ») ; un train en retard : « IC 07:42 +2 » (B13).
 */
export function thenLine131(j: OJourney, leg: number): Want | null {
  const n = j.legs[leg + 1];
  if (!n) return null;
  const minOf = (w: OLeg) => w.walkMin ?? Math.max(1, Math.round((w.arr - w.dep) / 60_000));
  const ride = (r: OLeg): string => {
    const p = r.newPlatform ?? r.platform;
    return isTrain(r) && p ? `(voie ${esc(p)}, )?${esc(vehicleWhen(r))}(, voie ${esc(p)}( !)?)?` : esc(vehicleWhen(r));
  };
  if (n.kind === 'walk') {
    const r = j.legs[leg + 2];
    if (!r) return `ensuite : ${minOf(n)} min à pied`;
    const tight = (connectionMargin(j, leg + 2) ?? 99) <= 1;
    const walk = `${minOf(n)} min à pied → ${esc(r.from.name.fr)}`;
    return tight ? new RegExp(`^ensuite : (${ride(r)}|${walk}), très juste$`) : new RegExp(`^ensuite : (${walk}|${ride(r)})$`);
  }
  return new RegExp(`^ensuite : ${ride(n)}$`);
}

/** 1.3.1 (B12, L4 ; B18) : virage, une majuscule en tête (« À gauche dans 30 m ») ; demi-tour (A6). */
export function turnRe(): RegExp {
  return SPEC.v131
    ? /^(Légèrement à gauche|Légèrement à droite|Franchement à gauche|Franchement à droite|À gauche|À droite)( dans \d+ m| maintenant)$|^Fais demi-tour$/
    : /^(légèrement |franchement )?(à gauche|à droite)( dans \d+ m| maintenant)$|^Fais demi-tour$/;
}

/* ------------------------------ 1.3.1 : « Où tu en es » (§ 3, remplacé pour les mots par le § 12) ------------------------------ */

/**
 * Ce qu'attend « Où tu en es » de la 1.3.1 : titre « Guidage en cours » (l'heure à droite) ; 1re ligne « Jusqu'à … » ;
 * 2e ligne « Ensuite : … » (au plus clair, juste après) ; puis, dans l'ordre choisi par l'équipe, les lignes `must`
 * (chacune une fois) et celles de `may` s'il y a la place ; aucune autre ; aucune de `never` ; chaque chose une fois.
 */
export interface Where131 {
  until: Want;
  then: Want;
  must: Want[];
  may: Want[];
  never: RegExp[];
}

/** Rangée de progression d'un véhicule (1.2.5) : « ●─●─◎─○ descente dans 4 arrêts » (ou « … au prochain arrêt »). */
export const PROGRESS_RE = /^[●◎○─…]+ +(descente dans \d+ arrêts|descente au prochain arrêt|c’est ta descente)$/;
/** Chaîne du trajet (1.2.10) : « ● à pied ─ ◎ IC ─ ○ tram 3 ». */
export const CHAIN_RE = /^[●◎○] \S.*( ─ (…|[●◎○] \S.*?))+$/;

/** « Jusqu'à la place Fontainas » : la destination, même règle de nom que le titre du trajet (« Vers … » → « Jusqu'à … »). */
export function untilLine(title: string): Want {
  const t = norm(title).trim();
  const m = /^Vers (.+)$/.exec(t);
  const rest = m ? m[1] : t;
  // nom propre (« Bruxelles-Central ») ou nom commun du lieu (« la place Fontainas », « au bureau ») : les deux formes
  const lower = rest.charAt(0).toLowerCase() + rest.slice(1);
  // un nom propre (« Bruxelles-Central ») ou commun (« la place Fontainas », « au bureau », « à l’école »)
  return new RegExp(`^Jusqu’(à ${esc(rest)}|à (la |l’)?${esc(lower)}|au ${esc(lower)}|e chez .+)$`);
}

/** Écarts d'un écran « Où tu en es » de la 1.3.1 (vide : conforme). */
export function whereIssues131(s: { screen: string; title: string; clock?: string; lines: string[] }, w: Where131): string[] {
  const bad: string[] = [];
  if (s.screen !== 'guide') return [`écran du guidage attendu, vu « ${s.screen} »`];
  if (!matches(s.title, T131.whereTitle)) bad.push(`titre « ${s.title} » au lieu de « ${T131.whereTitle} » (PRD-1.3.1 § 3)`);
  if (!/^\d\d:\d\d$/.test(s.clock ?? '')) bad.push(`heure à droite du titre absente (« ${s.clock ?? ''} »)`);
  const hint = s.lines[s.lines.length - 1];
  // l'aide est la dernière ligne, même fausse (« toucher : effacer … ») : jamais comptée comme une ligne en trop
  const isHint = matches(hint, HINTS.moment) || /^toucher /.test(norm(hint));
  const body = s.lines.slice(0, isHint ? -1 : s.lines.length).filter((l) => l.trim());
  if (!matches(hint, HINTS.moment)) bad.push(`aide « ${norm(hint)} » au lieu de « ${HINTS.moment} » (PRD-1.3.1 § 2)`);
  if (!matches(body[0], w.until)) bad.push(`1re ligne « ${norm(body[0])} » au lieu de « Jusqu’à … » (la destination, comme le titre du trajet : ${showWant(w.until)} ; § 12)`);
  if (!matches(body[1], w.then)) bad.push(`2e ligne « ${norm(body[1])} » au lieu de ${showWant(w.then)} (§ 12 : « Ensuite : … », juste après)`);
  const rest = body.slice(2);
  for (const m of w.must) {
    const n = rest.filter((l) => matches(l, m)).length;
    if (!n) bad.push(`ligne ${showWant(m)} absente (§ 3, § 12)`);
    else if (n > 1) bad.push(`ligne ${showWant(m)} ${n} fois (§ 12 : chaque chose une seule fois)`);
  }
  for (const l of rest) if (![...w.must, ...w.may].some((x) => matches(l, x))) bad.push(`ligne en trop « ${norm(l)} »`);
  for (const l of body) for (const re of w.never) if (re.test(norm(l))) bad.push(`« ${norm(l)} » ne doit plus paraître (${re})`);
  const dup = body.filter((l, i) => body.findIndex((x) => norm(x) === norm(l)) !== i);
  if (dup.length) bad.push(`lignes répétées : ${JSON.stringify(dup)}`);
  bad.push(...typographyIssues([s.title, ...s.lines]));
  return bad;
}

/** Ce qui ne paraît plus sur « Où tu en es » (§ 3, § 12) : la marge, « Prochain : », « descente : X, HH:MM ». */
const WHERE_NEVER = [/marge \d+ min/, /^Prochain : /, /^descente : /];

/**
 * « Où tu en es » d'un trajet (genre trip) de la 1.3.1, phase par phase (sur le trajet guidé de quai.trip) :
 *  - `before` : « Ensuite : partir à 07:33 » (l'heure de « Partir maintenant »), « 9 min à pied jusqu'à la gare de Namur » ;
 *  - `walk` (marche vers le véhicule `leg`) : « Ensuite : IC 07:42 +2, voie 6 ! » ; « À pied vers l'arrêt Flagey » (le nom,
 *    § 4 ; un train : la voie, sinon la gare) ; la distance et les minutes ;
 *  - `wait` (à l'arrêt du véhicule `leg`) : « Ensuite : tram 3 à 08:44 » ; « À l'arrêt Gare du Nord » ;
 *  - `ride` (dans le véhicule `leg`, `nextIdx` : l'arrêt suivant) : « Ensuite : descente à Bruxelles-Nord, 08:42 » ; la
 *    progression (jamais effacée) ; « Prochain arrêt : Ottignies, 08:11 » (seulement pour l'arrêt suivant à bord) ;
 *  - `last` (dernière marche) : « Ensuite : arrivée ~08:58 » ; « À pied, 390 m, 5 min » (la destination est déjà dite).
 * La chaîne et l'arrivée restent s'il y a la place (permises) ; jamais deux fois l'arrivée.
 */
export function where131(j: OJourney, title: string, phase: 'before' | 'walk' | 'wait' | 'ride' | 'last', leg = 0, nextIdx = 0): Where131 {
  const until = untilLine(title);
  const arrival = new RegExp(`^arrivée ~?${esc(hm(j.arr))}$`);
  const chain = CHAIN_RE;
  const l = j.legs[leg];
  const p = l ? (l.newPlatform ?? l.platform) : undefined;
  const changed = !!l?.newPlatform && !!l?.platform && l.newPlatform !== l.platform;
  const rideThen = (r: OLeg) => new RegExp(`^Ensuite : ${esc(vehicleWhen(r))}${isTrain(r) && p ? `(, voie ${esc(p)}${changed ? '( !)?' : ''})?` : ''}$`);
  const dist = /^((\d+ m|\d+,\d km), )?\d+ min$/;
  switch (phase) {
    case 'before': {
      const r = j.legs[nextRide(j, 0)];
      return {
        until,
        then: `Ensuite : partir à ${hm(j.leaveAt)}`,
        must: [`${j.legs[0].walkMin ?? Math.max(1, Math.round((j.legs[0].arr - j.legs[0].dep) / 60_000))} min à pied jusqu’à ${walkTarget(j, 0, title)}`, arrival],
        may: [chain, ...(r ? [new RegExp(`^${esc(vehicleWhen(r))}(, voie \\S+( !)?)?$`), /^voie \S+( !)?$/] : [])],
        never: [...WHERE_NEVER, /^À pied vers /],
      };
    }
    case 'walk': {
      const train = l && isTrain(l);
      const toward = !l ? /^À pied vers / : train ? new RegExp(`^À pied vers (la voie ${esc(p ?? '?')}|la gare de ${esc(l.from.name.fr)})$`) : `À pied vers l’arrêt ${l.from.name.fr}`;
      return { until, then: rideThen(l), must: [toward, dist], may: [chain, arrival], never: [...WHERE_NEVER, /l’arrêt du /] };
    }
    case 'wait':
      return {
        until,
        then: rideThen(l),
        must: [isTrain(l) ? `À la gare de ${l.from.name.fr}` : `À l’arrêt ${l.from.name.fr}`],
        may: [chain, arrival, new RegExp(`^vers ${esc(l.head?.fr ?? '')}$`), /^voie \S+( !)?$/],
        never: WHERE_NEVER,
      };
    case 'ride': {
      const stops = l.stops ?? [];
      const n = stops[nextIdx];
      return {
        until,
        then: new RegExp(`^Ensuite : descente à ${esc(l.to.name.fr)}, ~?${esc(hm(l.arr))}$`),
        must: [PROGRESS_RE],
        may: [chain, arrival, ...(n && nextIdx < stops.length - 1 ? [new RegExp(`^Prochain arrêt : ${esc(n.name.fr)}, ~?\\d\\d:\\d\\d$`)] : [])],
        never: WHERE_NEVER,
      };
    }
    case 'last':
      // § 12 : « chaque chose une seule fois » : la destination est dite par « Jusqu'à … », la ligne de la marche ne la
      // redit pas (« À pied, 390 m, 5 min », et non « À pied vers la place Fontainas » comme en 1.2.10)
      return { until, then: new RegExp(`^Ensuite : arrivée ~?${esc(hm(j.arr))}$`), must: [/^À pied, ((\d+ m|\d+,\d km), )?\d+ min$/], may: [chain], never: [...WHERE_NEVER, /^arrivée /, /^À pied vers /] };
  }
}

/** « Où tu en es » d'un « j'y descends » (genre ride, § 12) : pas de chaîne, « Quai te dit quand descendre ». */
export function whereRide131(j: OJourney, title: string, nextIdx: number): Where131 {
  const w = where131(j, title, 'ride', rides(j)[0] ?? 0, nextIdx);
  return { ...w, must: [...w.must, T131.rideNote], may: w.may.filter((x) => x !== CHAIN_RE), never: [...w.never, CHAIN_RE] };
}
