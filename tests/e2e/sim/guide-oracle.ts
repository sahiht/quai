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

/** Aides des écrans du guidage (PRD § 3.2, § 3.3, § 5, § 3.1). */
export const HINTS = {
  moment: 'toucher : effacer   appui long : arrêter',
  arrived: 'toucher : terminer',
  stepsGo: '△▽ étapes   toucher : y aller   double : retour',
  /** trajet guidé : arbitrage de l'intégrateur (toucher rouvre le guidage), le PRD § 5 disait « △▽ étapes   double : retour » */
  stepsGuided: '△▽ étapes   toucher : guidage   double : retour',
  stopsAlight: '△▽ arrêts   toucher : j’y descends   double : retour',
} as const;

/** Menu de l'appui long (PRD § 3.4) : identifiants 1 et 2. */
export const MENU = ['Arrêter le guidage', 'Voir tout le trajet'] as const;
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
  out.push(stopsPhrase(stopsToAlight(l)));
  const prev = j.legs[leg - 1];
  if (prev && prev.kind === 'walk' && leg > 1) out.push(/^\d+ min à pied jusqu’au quai, marge \d+ min$/);
  return out;
}

/** Moment « platform » : « Voie modifiée » ; « IC à 07:30, voie 6 au lieu de 4 ». */
export function platformLines(l: OLeg): Want[] {
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
