/** Réglage 2 sur 6 : mes lieux (adresse saisie ou position actuelle, marche maximale). Maquette Config2. */
import type { NearbyItem, Place, SearchItem } from '../../core/api';
import { displayName, mainMode, modeWord } from '../../core/util';
import { LIMITS, newId } from '../../settings';
import { header, type PhoneCtx } from '../app';
import { debounce, h, icon, ICON, liveRegion } from '../dom';
import { listRow, stepper } from '../ui';

/** « Namur à 7 min à pied, bus TEC à 2 min » : accès depuis un lieu. */
export function accessText(list: NearbyItem[], lang: 'fr' | 'nl' | 'local'): string {
  const station = list.find((n) => mainMode(n.area.modes) === 'train');
  const other = list.find((n) => mainMode(n.area.modes) !== 'train');
  const parts: string[] = [];
  if (station) parts.push(`${displayName(station.area.n, lang)} à ${station.walkMin} min à pied`);
  if (other) parts.push(`${modeWord(mainMode(other.area.modes), other.area.op)} à ${other.walkMin} min`);
  if (!parts.length) return 'Aucun arrêt à moins de 800 m';
  return station ? parts.join(', ') : `${parts[0]} à pied`;
}

const placeIcon = (label: string) => (/maison|domicile|chez/i.test(label) ? icon('home') : /bureau|travail|boulot/i.test(label) ? icon('work') : icon('pin'));

export function placesScreen(ctx: PhoneCtx): HTMLElement {
  const s = ctx.settings.get();
  const list = h('ul', { class: 'list box' });
  for (const p of s.places) {
    const row = listRow({ icon: placeIcon(p.label), title: p.label, sub: p.address ?? coords(p), sub2: ' ', label: `Modifier ${p.label}`, onClick: () => ctx.go(`#/lieux/${encodeURIComponent(p.id)}`) });
    list.appendChild(row);
    void ctx
      .core()
      .then((core) => core.nearby(p.lat, p.lon, 800))
      .then((items) => {
        const t3 = row.querySelector('.t3');
        if (t3) t3.textContent = accessText(items, s.lang);
      })
      .catch(() => {
        const t3 = row.querySelector('.t3');
        if (t3) t3.textContent = '';
      });
  }
  if (!s.places.length) list.appendChild(h('li', { class: 'small', style: 'padding:14px 16px' }, 'Aucun lieu pour l’instant. Ajoute Maison ou Bureau.'));
  return h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:16px' },
    header(ctx, 'Mes lieux', 'Les arrêts proches sont trouvés automatiquement.', { label: 'Accueil', hash: '#/' }),
    list,
    h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => ctx.go('#/lieux/nouveau'), disabled: s.places.length >= LIMITS.places, html: `${ICON.plus}<span>Ajouter un lieu</span>` }),
    h(
      'div',
      { class: 'box' },
      stepper({
        label: 'Marche maximale',
        sub: 'vers un arrêt ou une gare',
        value: s.maxWalkMin,
        min: LIMITS.maxWalkMin[0],
        max: LIMITS.maxWalkMin[1],
        format: (v) => `${v} min`,
        less: 'Réduire la marche maximale',
        more: 'Augmenter la marche maximale',
        onChange: (v) => void ctx.settings.update((x) => ({ ...x, maxWalkMin: v })),
      }),
    ),
    h('p', { class: 'note', html: `${ICON.clock}<span>Chaque nuit, Quai prépare les horaires du jour ; les trajets entre tes lieux sont calculés sur le téléphone, correspondances comprises.</span>` }),
  );
}

const coords = (p: { lat: number; lon: number }): string => `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;

/** « 50.4655, 4.8590 » ou « 50,4655 ; 4,8590 » saisi dans le champ adresse. */
export function parseCoords(text: string): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1].replace(',', '.'));
  const lon = Number(m[2].replace(',', '.'));
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

export function placeEditScreen(ctx: PhoneCtx, id: string): HTMLElement {
  const s = ctx.settings.get();
  const existing = s.places.find((p) => p.id === id);
  const isNew = !existing;
  const draft: Partial<Place> = existing ? { ...existing } : {};
  const live = liveRegion();
  const name = h('input', { id: 'pl-name', class: 'input', type: 'text', value: draft.label ?? '', maxlength: LIMITS.label, autocomplete: 'off', placeholder: 'Maison, Bureau…' });
  const addr = h('input', { id: 'pl-addr', class: 'input', type: 'text', value: draft.address ?? '', maxlength: LIMITS.address, autocomplete: 'street-address', placeholder: 'Rue, commune (ou « 50.4655, 4.8590 »)' });
  const where = h('p', { class: 'small', id: 'pl-where' });
  const save = h('button', { type: 'button', class: 'btn btn-primary btn-big btn-block' }, 'Enregistrer le lieu');
  const sync = (): void => {
    where.textContent = draft.lat !== undefined && draft.lon !== undefined ? `Position du lieu : ${coords(draft as Place)}${draft.address ? '' : ''}` : 'Position du lieu : pas encore choisie.';
    save.disabled = !name.value.trim() || draft.lat === undefined;
  };
  name.addEventListener('input', sync);
  addr.addEventListener('input', () => {
    const c = parseCoords(addr.value);
    if (c) {
      draft.lat = c.lat;
      draft.lon = c.lon;
    }
    sync();
  });
  const here = h('button', { type: 'button', class: 'btn btn-secondary btn-block', html: `${ICON.pin}<span>Utiliser ma position actuelle</span>` });
  here.addEventListener('click', async () => {
    live.say('Recherche de la position…');
    const fix = await ctx.location.current(10_000);
    if (!fix) return live.say('Position indisponible : autorise la position pour Quai dans l’appli Even.', true);
    draft.lat = Math.round(fix.lat * 1e5) / 1e5;
    draft.lon = Math.round(fix.lon * 1e5) / 1e5;
    live.say('Position actuelle enregistrée pour ce lieu.');
    sync();
  });
  const stopQ = h('input', { id: 'pl-stop', class: 'input', type: 'search', autocomplete: 'off', placeholder: 'Nom d’un arrêt ou d’une gare' });
  const results = h('ul', { class: 'suggest', 'aria-label': 'Arrêts proposés' });
  const search = debounce(async () => {
    const q = stopQ.value.trim();
    results.replaceChildren();
    if (q.length < 2) return;
    try {
      const core = await ctx.core();
      const items: SearchItem[] = await core.search(q, ctx.location.last() ?? undefined);
      for (const it of items.slice(0, 6)) {
        results.appendChild(
          h(
            'li',
            null,
            h(
              'button',
              {
                type: 'button',
                onclick: () => {
                  draft.lat = it.lat;
                  draft.lon = it.lon;
                  if (!addr.value.trim()) {
                    addr.value = `Près de ${displayName(it.n, s.lang)}`;
                    draft.address = addr.value;
                  }
                  results.replaceChildren();
                  stopQ.value = '';
                  live.say(`Lieu placé près de ${displayName(it.n, s.lang)}.`);
                  sync();
                },
              },
              h('span', { class: 's1' }, displayName(it.n, s.lang)),
              h('span', { class: 's2' }, it.kindLabel),
            ),
          ),
        );
      }
    } catch (e) {
      live.say(e instanceof Error ? e.message : 'Recherche impossible', true);
    }
  }, 250);
  stopQ.addEventListener('input', search);
  save.addEventListener('click', async () => {
    const label = name.value.trim();
    if (!label || draft.lat === undefined || draft.lon === undefined) return;
    const place: Place = { id: existing?.id ?? newId('lieu', s.places.map((p) => p.id)), label, lat: draft.lat, lon: draft.lon };
    const a = addr.value.trim();
    if (a) place.address = a;
    await ctx.settings.update((x) => ({ ...x, places: isNew ? [...x.places, place] : x.places.map((p) => (p.id === place.id ? place : p)) }));
    ctx.go('#/lieux');
  });
  const del = existing
    ? h('button', {
        type: 'button',
        class: 'btn btn-danger btn-block',
        onclick: async () => {
          if (!window.confirm(`Supprimer le lieu « ${existing.label} » ?`)) return;
          await ctx.settings.update((x) => ({ ...x, places: x.places.filter((p) => p.id !== existing.id), favorites: x.favorites.filter((f) => !(f.kind === 'trip' && [f.from, f.to].some((e) => e.type === 'place' && e.placeId === existing.id))) }));
          ctx.go('#/lieux');
        },
      }, 'Supprimer ce lieu')
    : null;
  sync();
  return h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:16px' },
    header(ctx, isNew ? 'Nouveau lieu' : existing!.label, undefined, { label: 'Mes lieux', hash: '#/lieux' }),
    h('div', { class: 'field' }, h('label', { for: 'pl-name' }, 'Nom du lieu'), name),
    h('div', { class: 'field' }, h('label', { for: 'pl-addr' }, 'Adresse (texte libre)'), addr),
    h('section', { class: 'box pad' }, h('h2', null, 'Position du lieu'), where, here, h('div', { class: 'field' }, h('label', { for: 'pl-stop' }, 'Ou placer le lieu près d’un arrêt'), stopQ), results, live.el),
    save,
    del,
  );
}
