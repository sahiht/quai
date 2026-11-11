/**
 * Champ unique (PRD M4) : un seul champ pour choisir un endroit, partout où l'on en choisit un (départ et arrivée
 * d'une recherche ou d'un trajet favori, adresse d'un lieu, premier lancement).
 * Propositions, type à droite : « Ma position », mes lieux, adresses récentes (S4), puis adresses et gares ou arrêts,
 * les adresses d'abord si le texte ressemble à une adresse. Au plus 4 adresses et 6 gares ou arrêts.
 * Gares et arrêts tout de suite (fichiers de recherche) ; adresses par core.geocode dès 3 caractères, après 250 ms
 * sans frappe. Seul le texte tapé part vers le service d'adresses (la position sert au tri, sur le téléphone).
 */
import type { GeocodeAnswer, GeocodeResult, NameLang, Place, SearchItem } from '../core/api';
import { displayName } from '../core/util';
import { matchesQuery } from '../../../shared/names';
import type { PhoneCtx } from './app';
import { h } from './dom';
import { geoLang, letterCount, looksLikeAddress, T, typo } from './text';

export type FieldChoice =
  | { kind: 'here'; label: string }
  | { kind: 'place'; place: Place; label: string }
  | { kind: 'address'; label: string; lat: number; lon: number; approx?: boolean; recent: boolean }
  | { kind: 'stop'; item: SearchItem; label: string };

export interface FieldOptions {
  id: string;
  label: string;
  placeholder?: string;
  /** Choix déjà fait, écrit dans le champ. */
  value?: string;
  /** Propositions locales : « Ma position », mes lieux, adresses récentes. */
  here?: boolean;
  places?: boolean;
  recent?: boolean;
  onPick(c: FieldChoice): void;
  /** Le texte a changé après un choix : le choix précédent ne vaut plus. */
  onEdit?(): void;
  onFocus?(): void;
}

export interface PlaceField {
  /** Champ complet pour un formulaire : étiquette, saisie, propositions, état. */
  el: HTMLElement;
  label: HTMLLabelElement;
  input: HTMLInputElement;
  list: HTMLUListElement;
  status: HTMLParagraphElement;
  /** Écrit un choix dans le champ, sans chercher. */
  show(text: string): void;
  /** Remplit le champ et cherche (« Vérifier l’adresse »). */
  search(text: string): void;
  close(): void;
  /** Vrai si le texte du champ est un choix, pas une saisie en cours. */
  picked(): boolean;
}

export const GEO_DELAY_MS = 250;
export const MAX_ADDRESSES = 4;
export const MAX_STOPS = 6;

/** Sources des adresses (Q10) ; remplacée par la mention rendue par le relais dès une recherche d'adresse. */
export const DEFAULT_ATTRIBUTION = 'Adresses : Digitaal Vlaanderen, Paradigm (UrbIS), SPW (ICAR)';
let lastAttribution = '';
export const addressAttribution = (): string => lastAttribution || DEFAULT_ATTRIBUTION;

/** Libellé d'une adresse trouvée, dans la langue des noms si le service la donne (Bruxelles). */
export function addressLabel(r: GeocodeResult, lang: NameLang): string {
  const named = lang === 'nl' ? r.names?.nl : lang === 'fr' ? r.names?.fr : undefined;
  return (named || r.label).trim();
}

/** Rue sans numéro : position approximative, « (sans numéro) » dans les propositions. */
export const streetOnly = (r: GeocodeResult): boolean => r.kind === 'rue';

/** Mention sous le champ (PRD M4.9, § 6.2). */
export function privacyNote(): HTMLParagraphElement {
  return h('p', { class: 'small muted privacy' }, typo(T.privacy));
}

interface Option {
  label: string;
  type: string;
  pick: () => void;
}

export function placeField(ctx: PhoneCtx, o: FieldOptions): PlaceField {
  const listId = `${o.id}-liste`;
  const statusId = `${o.id}-etat`;
  const label = h('label', { for: o.id }, o.label);
  const input = h('input', {
    id: o.id,
    class: 'input',
    type: 'text',
    value: o.value ?? '',
    placeholder: o.placeholder,
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    'aria-describedby': statusId,
  });
  const list = h('ul', { class: 'suggest', id: listId, role: 'listbox', 'aria-label': `${o.label} : propositions`, hidden: true });
  const status = h('p', { class: 'field-note', id: statusId, role: 'status', 'aria-live': 'polite' });
  const el = h('div', { class: 'field place-field' }, label, input, list, status);

  let picked = !!o.value;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Requête en cours : stops null = gares et arrêts en attente ; geo null = adresses en attente, 'skip' = pas cherchées. */
  let st: { q: string; stops: SearchItem[] | null; geo: GeocodeAnswer | null | 'skip' } = { q: '', stops: [], geo: 'skip' };

  const settings = () => ctx.settings.get();
  const near = () => {
    const f = ctx.location.last();
    return f ? { lat: f.lat, lon: f.lon } : undefined;
  };

  function close(): void {
    clearTimeout(timer);
    seq++;
    list.replaceChildren();
    list.hidden = true;
    status.textContent = '';
    input.setAttribute('aria-expanded', 'false');
  }

  function pick(c: FieldChoice): void {
    input.value = c.label;
    picked = true;
    close();
    o.onPick(c);
  }

  function options(): { items: Option[]; addresses: number } {
    const s = settings();
    const q = st.q;
    const items: Option[] = [];
    if (o.here && (!q || matchesQuery(q, 'Ma position'))) items.push({ label: 'Ma position', type: 'position actuelle', pick: () => pick({ kind: 'here', label: 'Ma position' }) });
    if (o.places) {
      for (const p of s.places) if (!q || matchesQuery(q, p.label)) items.push({ label: p.label, type: 'mon lieu', pick: () => pick({ kind: 'place', place: p, label: p.label }) });
    }
    const recentLabels = new Set<string>();
    if (o.recent) {
      for (const r of s.recent) {
        if (q && !matchesQuery(q, r.label)) continue;
        recentLabels.add(r.label.toLowerCase());
        items.push({ label: r.label, type: 'récent', pick: () => pick({ kind: 'address', label: r.label, lat: r.lat, lon: r.lon, approx: r.approx, recent: true }) });
      }
    }
    const stops: Option[] = (st.stops ?? []).slice(0, MAX_STOPS).map((it) => {
      const name = displayName(it.n, s.lang);
      return { label: name, type: it.kindLabel, pick: () => pick({ kind: 'stop', item: it, label: name }) };
    });
    const geo = st.geo && st.geo !== 'skip' ? st.geo : null;
    const addresses: Option[] = [];
    for (const r of geo?.results ?? []) {
      const text = addressLabel(r, s.lang);
      if (recentLabels.has(text.toLowerCase()) || addresses.some((a) => a.label.startsWith(text))) continue;
      const approx = r.approx || streetOnly(r);
      addresses.push({
        label: streetOnly(r) ? `${text} (sans numéro)` : text,
        type: 'adresse',
        pick: () => pick({ kind: 'address', label: text, lat: r.lat, lon: r.lon, approx: approx || undefined, recent: false }),
      });
      if (addresses.length >= MAX_ADDRESSES) break;
    }
    if (looksLikeAddress(q)) items.push(...addresses, ...stops);
    else items.push(...stops, ...addresses);
    return { items, addresses: addresses.length };
  }

  function note(count: number, addresses: number): string {
    const q = st.q;
    const geo = st.geo && st.geo !== 'skip' ? st.geo : null;
    if (geo?.error === 'offline') return T.addrOffline;
    if (geo?.error === 'down') return T.addrDown;
    const stopsDone = st.stops !== null;
    if (q.length >= 3 && stopsDone && st.geo !== null && count === 0) return T.nothing;
    if (!looksLikeAddress(q) && letterCount(q) >= 3 && stopsDone && st.stops!.length === 0 && addresses === 0) return T.addrHint;
    return '';
  }

  function render(): void {
    const { items, addresses } = options();
    list.replaceChildren(
      ...items.map((x) =>
        h(
          'li',
          { role: 'none' },
          h('button', { type: 'button', role: 'option', 'aria-selected': 'false', onclick: x.pick }, h('span', { class: 's1' }, x.label), h('span', { class: 's2' }, x.type)),
        ),
      ),
    );
    list.hidden = !items.length;
    input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
    status.textContent = typo(note(items.length, addresses));
  }

  function query(raw: string): void {
    const q = raw.trim().replace(/\s+/g, ' ');
    const my = ++seq;
    clearTimeout(timer);
    st = { q, stops: q.length >= 2 ? null : [], geo: q.length >= 3 ? null : 'skip' };
    render();
    if (q.length >= 2) {
      void (async () => {
        let items: SearchItem[] = [];
        try {
          items = await (await ctx.core()).search(q, near());
        } catch {
          items = [];
        }
        if (my !== seq) return;
        st.stops = items;
        render();
      })();
    }
    if (q.length >= 3) {
      timer = setTimeout(() => {
        void (async () => {
          let ans: GeocodeAnswer;
          try {
            ans = await (await ctx.core()).geocode(q, geoLang(settings().lang), near() ?? null);
          } catch {
            ans = { results: [], error: 'down' };
          }
          if (my !== seq) return;
          if (ans.attribution) lastAttribution = ans.attribution;
          st.geo = ans;
          render();
        })();
      }, GEO_DELAY_MS);
    }
  }

  input.addEventListener('input', () => {
    if (picked) {
      picked = false;
      o.onEdit?.();
    }
    query(input.value);
  });
  input.addEventListener('focus', () => {
    o.onFocus?.();
    if (picked) {
      // Un choix est affiché : propositions de départ (« Ma position », lieux, récents) ; la saisie le remplace.
      query('');
      input.select();
    } else query(input.value);
  });
  input.addEventListener('keydown', (e) => {
    const first = list.querySelector<HTMLButtonElement>('button');
    if (e.key === 'ArrowDown' && first) {
      e.preventDefault();
      first.focus();
    } else if (e.key === 'Enter' && first) {
      e.preventDefault();
      first.click();
    } else if (e.key === 'Escape') close();
  });
  list.addEventListener('keydown', (e) => {
    const buttons = [...list.querySelectorAll<HTMLButtonElement>('button')];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[Math.min(buttons.length - 1, i + 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (i <= 0) input.focus();
      else buttons[i - 1].focus();
    } else if (e.key === 'Escape') {
      close();
      input.focus();
    }
  });
  // Toucher ailleurs ferme les propositions (après le toucher, pour ne jamais le détourner).
  const outside = (e: Event): void => {
    if (!input.isConnected) {
      document.removeEventListener('click', outside);
      return;
    }
    const t = e.target as Node | null;
    if (list.hidden || !t || input.contains(t) || list.contains(t) || label.contains(t)) return;
    close();
  };
  document.addEventListener('click', outside);

  return {
    el,
    label,
    input,
    list,
    status,
    show(text) {
      input.value = text;
      picked = true;
      close();
    },
    search(text) {
      input.value = text;
      picked = false;
      input.focus({ preventScroll: true });
      query(text);
    },
    close,
    picked: () => picked,
  };
}
