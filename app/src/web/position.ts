/**
 * Quai Web : rubrique « Position » (sous l'écran des lunettes, et dans « Position et langue ») : état de la position
 * du navigateur en clair, et choix d'un endroit quand elle est refusée, indisponible ou imprécise, ou à la place
 * (PRD-1.2 § 3) : le champ unique du téléphone, avec les lieux d'abord, puis les adresses récentes, les adresses (par
 * le relais, comme le téléphone), les gares et les arrêts. Seul le texte tapé part vers le service d'adresses.
 */
import type { Core } from '../core/api';
import { shortAddress } from '../core/text';
import type { SettingsStore } from '../settings';
import { h, ICON, svgNode } from '../phone/dom';
import { placeField, privacyNote, withRecent, type FieldChoice } from '../phone/field';
import { T } from '../phone/text';
import { locationText, type ManualPosition, type WebLocation } from './location';

export interface PositionDeps {
  location: WebLocation;
  core(): Promise<Core>;
  /** Réglages : lieux, adresses récentes, langue des noms. */
  settings: SettingsStore;
  /** La position a changé (endroit choisi, retour au navigateur) : à transmettre aux lunettes. */
  changed(): void;
  /** Préfixe des identifiants (deux rubriques peuvent coexister). */
  id: string;
  /** Heure des adresses récentes (horloge de l'appli). */
  now?(): number;
}

const NEEDS_PICK = new Set(['denied', 'unavailable', 'insecure', 'unsupported']);

/**
 * Position choisie à partir d'un choix du champ : un lieu par son nom (« Bureau »), une adresse courte (« Rue de Fer
 * 25 », une rue sans numéro : « Rue de Fer (sans numéro) »), un arrêt avec son type (« Namur (gare SNCB) »).
 */
export function manualOf(c: FieldChoice): ManualPosition | null {
  if (c.kind === 'place') return { lat: c.place.lat, lon: c.place.lon, label: c.place.label };
  if (c.kind === 'address') {
    const short = shortAddress(c.label);
    return { lat: c.lat, lon: c.lon, label: c.approx && !/\d/.test(short) ? `${short} (sans numéro)` : short };
  }
  if (c.kind === 'stop') return { lat: c.item.lat, lon: c.item.lon, label: `${c.label} (${c.item.kindLabel})` };
  return null;
}

export function positionCard(d: PositionDeps): HTMLElement {
  const status = h('p', { class: 'small w-pos-status', role: 'status', 'aria-live': 'polite' });
  const gps = h('button', { type: 'button', class: 'btn btn-secondary btn-block' });
  const pick = h('button', { type: 'button', class: 'btn-link w-pos-pick' });
  let open = false;
  const field = placeField(
    { settings: d.settings, core: d.core, location: d.location },
    {
      id: `${d.id}-q`,
      label: 'Choisir une adresse, une gare ou un arrêt',
      placeholder: 'Adresse, gare ou arrêt',
      places: true,
      recent: true,
      onPick: (c) => {
        const m = manualOf(c);
        if (!m) return;
        if (c.kind === 'address') void d.settings.update((s) => withRecent(s, c, d.now?.() ?? Date.now()));
        d.location.setManual(m);
        field.show('');
        open = false;
        paint();
        d.changed();
      },
    },
  );
  const fieldBox = h('div', { class: 'w-pos-field' }, field.el, privacyNote(T.privacyWeb));
  const card = h('div', { class: 'w-pos' }, status, gps, pick, fieldBox);

  function paint(): void {
    const s = d.location.state();
    status.textContent = locationText(s);
    const needsPick = NEEDS_PICK.has(s.kind);
    fieldBox.hidden = !(needsPick || open);
    pick.hidden = needsPick || open || s.kind === 'mock';
    pick.textContent = s.kind === 'manual' ? 'Choisir un autre endroit' : 'Choisir une adresse ou un arrêt à la place';
    gps.hidden = !(s.kind === 'manual' || needsPick || s.kind === 'idle');
    gps.replaceChildren(svgNode(ICON.pin), h('span', null, s.kind === 'manual' ? 'Revenir à la position du navigateur' : needsPick ? 'Réessayer la position du navigateur' : 'Utiliser la position du navigateur'));
  }

  const unsubscribe = d.location.subscribe(() => {
    if (!card.isConnected && card.dataset.mounted === '1') {
      unsubscribe();
      return;
    }
    paint();
  });

  gps.addEventListener('click', async () => {
    gps.disabled = true;
    open = false;
    d.location.setManual(null);
    status.textContent = 'Recherche de ta position…';
    await d.location.current(10_000);
    gps.disabled = false;
    paint();
    d.changed();
  });
  pick.addEventListener('click', () => {
    open = true;
    paint();
    field.input.focus();
  });

  paint();
  // une fois la rubrique en place (après le rendu de l'écran), son retrait de la page met fin à l'abonnement
  setTimeout(() => {
    if (card.isConnected) card.dataset.mounted = '1';
  }, 0);
  return card;
}
