/**
 * Quai Web : rubrique « Position » (sous l'écran des lunettes, et dans « Position et langue ») :
 * état de la position du navigateur en clair, et choix d'un arrêt ou d'une gare quand elle est refusée,
 * indisponible ou imprécise.
 */
import type { Core, NameLang } from '../core/api';
import { displayName } from '../core/util';
import { debounce, h, ICON } from '../phone/dom';
import { locationText, type WebLocation } from './location';

export interface PositionDeps {
  location: WebLocation;
  core(): Promise<Core>;
  lang(): NameLang;
  /** La position a changé (arrêt choisi, retour au navigateur) : à transmettre aux lunettes. */
  changed(): void;
  /** Préfixe des identifiants (deux rubriques peuvent coexister). */
  id: string;
}

const NEEDS_PICK = new Set(['denied', 'unavailable', 'insecure', 'unsupported']);

export function positionCard(d: PositionDeps): HTMLElement {
  const status = h('p', { class: 'small w-pos-status', role: 'status', 'aria-live': 'polite' });
  const gps = h('button', { type: 'button', class: 'btn btn-secondary btn-block' });
  const pick = h('button', { type: 'button', class: 'btn-link w-pos-pick' });
  const input = h('input', { id: `${d.id}-q`, class: 'input', type: 'search', autocomplete: 'off', enterkeyhint: 'search', placeholder: 'Nom d’une gare ou d’un arrêt', 'aria-controls': `${d.id}-list` });
  const list = h('ul', { class: 'suggest', id: `${d.id}-list`, 'aria-label': 'Arrêts proposés' });
  const field = h('div', { class: 'field' }, h('label', { for: input.id }, 'Choisir un arrêt ou une gare'), input, list);
  const card = h('div', { class: 'w-pos' }, status, gps, pick, field);
  let open = false;

  const paint = (): void => {
    const s = d.location.state();
    status.textContent = locationText(s);
    const needsPick = NEEDS_PICK.has(s.kind);
    field.hidden = !(needsPick || open);
    pick.hidden = needsPick || open || s.kind === 'mock';
    pick.textContent = s.kind === 'manual' ? 'Choisir un autre arrêt' : 'Choisir un arrêt à la place';
    gps.hidden = !(s.kind === 'manual' || needsPick || s.kind === 'idle');
    gps.innerHTML = `${ICON.pin}<span>${s.kind === 'manual' ? 'Revenir à la position du navigateur' : needsPick ? 'Réessayer la position du navigateur' : 'Utiliser la position du navigateur'}</span>`;
  };

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
    input.focus();
  });

  const search = debounce(async () => {
    const q = input.value.trim();
    list.replaceChildren();
    if (q.length < 2) return;
    try {
      const core = await d.core();
      const items = await core.search(q, d.location.last() ?? undefined);
      if (input.value.trim() !== q) return;
      for (const it of items.slice(0, 6)) {
        const name = displayName(it.n, d.lang());
        list.appendChild(
          h(
            'li',
            null,
            h(
              'button',
              {
                type: 'button',
                onclick: () => {
                  d.location.setManual({ lat: it.lat, lon: it.lon, label: `${name} (${it.kindLabel})` });
                  input.value = '';
                  list.replaceChildren();
                  open = false;
                  paint();
                  d.changed();
                },
              },
              h('span', { class: 's1' }, name),
              h('span', { class: 's2' }, it.kindLabel),
            ),
          ),
        );
      }
      if (!items.length) list.appendChild(h('li', { class: 'small muted', style: 'padding:10px 12px' }, 'Aucun arrêt ne correspond.'));
    } catch (e) {
      list.replaceChildren(h('li', { class: 'small', role: 'alert', style: 'padding:10px 12px' }, e instanceof Error ? e.message : 'Recherche indisponible'));
    }
  }, 220);
  input.addEventListener('input', search);

  paint();
  // une fois la rubrique en place (après le rendu de l'écran), son retrait de la page met fin à l'abonnement
  setTimeout(() => {
    if (card.isConnected) card.dataset.mounted = '1';
  }, 0);
  return card;
}
