/**
 * 1.3.1 (PRD-1.3.1 § 14, R1) : sortie du métro ou du prémétro à montrer après une descente (« Sortie : Boulevard
 * Anspach », 3e ligne pâle de l'écran de la marche, B17), par rang de la marche qui suit (GuideInput.exitByLeg).
 *
 * Une sortie seulement quand la marche mène à la rue :
 * - le véhicule quitté est de la STIB, non supprimé, et son arrêt physique de descente est dans exits.json (arrêt sous
 *   terre avec au moins une sortie au nom de rue ou de place) ;
 * - la marche ne mène pas à un autre quai sous terre (correspondance de métro ou de prémétro : on ne sort pas) ni à un
 *   train (la gare se rejoint par ses couloirs, pas par une rue) ;
 * - la marche ne mène pas à un tram ou à un métro de la même station (même zone, sinon même nom). Run de vérification
 *   du 20/11 à 22:15 : 31 arrêts de tram de stations du fichier n'y sont pas, dont les quais du prémétro de Gare du
 *   Midi (0631, 0636), sous terre ; on ne sait pas d'ici lesquels sont en surface. Une sortie utile est perdue vers un
 *   tram de surface de la même station (Louise, Botanique) : accepté, plutôt qu'une sortie dite à tort quai à quai.
 * La ligne reste vers un bus, vers un arrêt d'une autre station, et pour la dernière marche vers la destination.
 * La sortie est choisie vers le bout de cette marche (chooseExit : couloir plus vol d'oiseau jusqu'à l'arrêt suivant ou
 * la destination) ; bout inconnu : la sortie seulement si l'arrêt n'en a qu'une. Calcul sur le téléphone, avec le
 * fichier public des sorties : rien n'est envoyé.
 */
import type { Journey, Leg } from './api';
import { chooseExit, exitsOf, type ExitsFile } from './walk/exits-format';

const known = (p: { lat?: number; lon?: number } | undefined): p is { lat: number; lon: number } =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && !(p.lat === 0 && p.lon === 0);

/** Nom de station replié pour comparer (casse, accents, tirets et apostrophes ignorés). */
const fold = (s: string | undefined): string =>
  (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Même station : la même zone d'arrêts, sinon le même nom (en français ou en néerlandais). */
function sameStation(a: Leg['to'], b: Leg['from']): boolean {
  if (a.areaId && a.areaId === b.areaId) return true;
  const fr = fold(a.name?.fr);
  const nl = fold(a.name?.nl);
  return (!!fr && fr === fold(b.name?.fr)) || (!!nl && nl === fold(b.name?.nl));
}

/**
 * La marche reste sous terre ou dans la gare, ou on ne peut pas l'exclure : le véhicule suivant est un train, part d'un
 * quai connu sous terre de la STIB, ou c'est un tram ou un métro de la station où l'on vient de descendre.
 */
function staysInside(f: ExitsFile, prev: Leg, next: Leg | undefined): boolean {
  if (!next || next.kind !== 'ride') return false;
  if (next.mode === 'train') return true;
  if (exitsOf(f, next.op, next.fromStop).length > 0) return true;
  return (next.mode === 'tram' || next.mode === 'metro') && sameStation(prev.to, next.from);
}

/**
 * Nom de la sortie par rang de marche (après une descente à un arrêt STIB sous terre) ; undefined s'il n'y en a aucune
 * (pas de fichier, pas d'arrêt sous terre, autre réseau, correspondance sous terre ou dans la même station).
 */
export function exitByLegOf(j: Journey, f: ExitsFile | null | undefined): Record<number, string> | undefined {
  if (!f) return undefined;
  const out: Record<number, string> = {};
  for (let i = 1; i < j.legs.length; i++) {
    const w = j.legs[i];
    const p = j.legs[i - 1];
    if (w.kind !== 'walk' || p.kind !== 'ride' || p.cancelled) continue;
    const exits = exitsOf(f, p.op, p.toStop);
    if (!exits.length || staysInside(f, p, j.legs[i + 1])) continue;
    // bout de la marche inconnu : avec plusieurs sorties, on ne saurait pas laquelle dire (jamais une sortie au hasard)
    if (!known(w.to) && exits.length > 1) continue;
    const e = chooseExit(exits, known(w.to) ? w.to : null);
    if (e) out[i] = e.name;
  }
  return Object.keys(out).length ? out : undefined;
}
