/**
 * Réglage 6 sur 6 : données (T6, maquette Config6) : état du relais (/api/health) et des services d'adresses,
 * fraîcheur des horaires, temps réel, version de Quai. 1.2.9 (PRD-1.2.9 § 2.3) : retour à Réglages.
 * 1.2.10 (PRD-1.2.10 § 3.8 et § 4.5) : carte « Chemins à pied » : OpenStreetMap, son attribution (licence ODbL) et son
 * état : « Disponible » quand le cœur calcule les chemins à pied (Core.walkRoute), sinon « Indisponible ».
 * 1.3.0 (PRD-1.3.0 § 6.4) : carte « Journal des trajets » (journalCard).
 */
import type { Core, HealthResponse, Meta } from '../../core/api';
import type { JournalTrip, TripJournal } from '../../core/journal-types';
import { brusselsParts, hhmm, localDate } from '../../core/util';
import type { Op } from '../../../../shared/types';
import { APP_VERSION } from '../../version';
import { header, type PhoneCtx } from '../app';
import { h, ICON, liveRegion } from '../dom';
import { addressAttribution } from '../field';
import { journalTripLine, T, typo } from '../text';
import { confirmInPage, copyText, nextId } from '../ui';

/** Nom affiché du flux GitHub Actions (`name:` de .github/workflows/nightly.yml), tel que GitHub le montre. */
export const NIGHTLY_WORKFLOW_NAME = 'Données de nuit';

export const STALE_HELP =
  `La mise à jour de nuit ne tourne plus : sur GitHub, onglet Actions, workflow « ${NIGHTLY_WORKFLOW_NAME} », bouton Enable workflow, puis Run workflow.`;

/**
 * État d'un réseau dans la liste « Réseaux » : horaires de la nuit absents, horaires gardés d'une nuit précédente
 * (meta.feeds[op].cachedFrom), sinon l'état du temps réel.
 */
export function networkText(sourceOk: boolean, feed: Meta['feeds'][Op] | undefined, checked: boolean): string {
  if (feed && !feed.ok) return 'Horaires absents cette nuit';
  if (feed?.cachedFrom) return `Horaires du ${feed.cachedFrom.slice(8, 10)}/${feed.cachedFrom.slice(5, 7)}, le portail n’a pas répondu cette nuit`;
  return sourceOk ? 'Temps réel' : checked ? 'Horaires prévus, temps réel indisponible' : '…';
}

const NETS: { op: Op; label: string }[] = [
  { op: 'sncb', label: 'SNCB' },
  { op: 'stib', label: 'STIB' },
  { op: 'delijn', label: 'De Lijn' },
  { op: 'tec', label: 'TEC' },
];

const REGIONS = [
  ['bru', 'à Bruxelles'],
  ['vla', 'en Flandre'],
  ['wal', 'en Wallonie'],
] as const;

/**
 * État des services d'adresses (carte « Adresses ») d'après /api/health : « Disponible », « Indisponible »,
 * ou « Disponible, sauf en Wallonie » quand une Région seulement ne répond pas. null : vérification en cours.
 */
export function addressStatus(health: HealthResponse | null, checked: boolean): { ok: boolean; text: string } {
  if (!health) return checked ? { ok: false, text: 'Indisponible' } : { ok: false, text: '…' };
  const g = health.geocode;
  const known = REGIONS.filter(([k]) => g?.[k]);
  if (!g || !known.length) return { ok: false, text: 'Indisponible' };
  const down = known.filter(([k]) => !g[k]!.ok).map(([, where]) => where);
  if (!down.length) return { ok: true, text: 'Disponible' };
  if (down.length === known.length) return { ok: false, text: 'Indisponible' };
  return { ok: true, text: `Disponible, sauf ${down.join(' et ')}` };
}

/** 1.2.10 : état des chemins à pied : le cœur sait-il les calculer (tuiles OpenStreetMap, Core.walkRoute) ? */
export function walkText(core: Pick<Core, 'walkRoute'> | null): { ok: boolean; text: string } {
  return core && typeof core.walkRoute === 'function' ? { ok: true, text: 'Disponible' } : { ok: false, text: 'Indisponible' };
}

/** 1.2.5 : état de la météo dans l'écran Données. */
export function weatherText(w: 'ok' | 'down' | 'unknown' | 'off'): { ok: boolean; text: string } {
  if (w === 'ok') return { ok: true, text: 'Disponible' };
  if (w === 'down') return { ok: false, text: 'Indisponible' };
  if (w === 'off') return { ok: false, text: 'Coupée dans Affichage' };
  return { ok: false, text: '…' };
}

/**
 * « Temps réel » de l'écran Données : la panne est dite juste (M8). État du cœur d'abord ; tant qu'aucun temps réel
 * n'a été demandé, le test du relais fait foi quand toutes les sources sont en panne.
 */
export function realtimeText(rt: 'ok' | 'down' | 'offline' | 'unknown' | undefined, health?: HealthResponse | null): string {
  if (rt === 'offline') return 'pas de réseau';
  const allDown = !!health && Object.values(health.sources ?? {}).every((x) => !x?.ok);
  if (rt === 'down' || (rt !== 'ok' && allDown)) return 'indisponible, horaires prévus';
  return 'toutes les 30 secondes';
}

/** « cette nuit, 03:12 » ou « le 07/11 à 03:12 ». */
export function generatedText(iso: string | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'inconnu';
  const p = brusselsParts(t);
  if (localDate(t) === localDate(now) && p.h < 12) return `cette nuit, ${hhmm(t)}`;
  if (localDate(t) === localDate(now)) return `aujourd’hui, ${hhmm(t)}`;
  return `le ${String(p.d).padStart(2, '0')}/${String(p.mo).padStart(2, '0')} à ${hhmm(t)}`;
}

/** 1.3.0 : trajets montrés dans « Journal des trajets » (le journal en garde 10). */
export const JOURNAL_SHOWN = 10;

/**
 * 1.3.0 (PRD-1.3.0 § 6.4) : carte « Journal des trajets » : les 10 derniers trajets guidés (ctx.journal, du plus récent au
 * plus ancien), chacun avec son titre, sa date, sa durée et sa fin en clair (« arrivé », « arrêté », « fini »,
 * « remplacé »). Toucher l'un ouvre son texte juste dessous (TripJournal.text), un seul à la fois, avec « Copier »
 * (presse-papiers, avec repli, puis « Copié. ») ; « Effacer le journal » demande confirmation. Journal vide : « Aucun
 * trajet guidé pour l’instant. ». Sans journal (ctx.journal absent ou pas prêt) : pas de carte.
 */
export function journalCard(ctx: PhoneCtx): HTMLElement | null {
  let journal: TripJournal | null = null;
  try {
    journal = ctx.journal?.() ?? null;
  } catch {
    journal = null;
  }
  if (!journal) return null;
  const j = journal;
  const id = nextId('journal');
  const list = h('ul', { class: 'list journal-list' });
  const empty = h('p', { class: 'small journal-empty', tabindex: '-1' }, T.journalEmpty);
  const clearSlot = h('div', { class: 'journal-clear' });
  const said = h('p', { class: 'msg', role: 'status' });
  /** Trajet dont le texte est ouvert, et de quoi le refermer. */
  let open: { id: string; close: () => void } | null = null;

  const trips = (): JournalTrip[] => {
    try {
      return j.list().slice(0, JOURNAL_SHOWN);
    } catch {
      return [];
    }
  };

  /**
   * Texte d'un trajet, sous sa ligne : un bloc lisible, une ligne du journal par ligne (une ligne trop longue continue en
   * retrait, l'heure reste visible en tête), puis « Copier », qui copie le texte du journal tel quel.
   */
  const textBlock = (t: JournalTrip, blockId: string): HTMLElement => {
    let text = '';
    try {
      text = j.text(t.id);
    } catch {
      text = '';
    }
    const lines = text.split('\n').filter((l) => l.trim());
    const block = h(
      'div',
      { class: 'journal-text', id: `${blockId}-texte`, role: 'group', 'aria-label': typo(`Journal du trajet « ${t.title} »`) },
      lines.map((l, i) => h('p', { class: i === 0 ? 'jl jl-head' : 'jl' }, l)),
    );
    const copy = h('button', { type: 'button', class: 'btn btn-secondary journal-copy' }, T.journalCopy);
    const msg = h('p', { class: 'msg', role: 'status' });
    copy.addEventListener('click', async () => {
      msg.textContent = '';
      msg.classList.remove('err');
      const ok = await copyText(text, block);
      msg.textContent = ok ? T.journalCopied : T.journalCopyManual;
      msg.classList.toggle('err', !ok);
    });
    return h('div', { class: 'journal-open', id: blockId }, block, h('div', { class: 'journal-actions' }, copy, msg));
  };

  const row = (t: JournalTrip, i: number): HTMLLIElement => {
    const blockId = `${id}-${i}`;
    const btn = h(
      'button',
      { type: 'button', class: 'row journal-row', 'aria-expanded': 'false' },
      h('span', { class: 'txt' }, h('span', { class: 't1' }, t.title), h('span', { class: 't2' }, typo(journalTripLine(t)))),
      h('span', { class: 'chev', html: ICON.chevron }),
    );
    const li = h('li', null, btn);
    const close = (): void => {
      li.querySelector('.journal-open')?.remove();
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-controls');
    };
    btn.addEventListener('click', () => {
      const was = open?.id === t.id;
      // un seul texte ouvert à la fois ; toucher celui qui est ouvert le referme
      open?.close();
      open = null;
      if (was) return;
      li.appendChild(textBlock(t, blockId));
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-controls', blockId);
      open = { id: t.id, close };
    });
    return li;
  };

  const paint = (): void => {
    const all = trips();
    open = null;
    list.replaceChildren(...all.map(row));
    list.hidden = !all.length;
    empty.hidden = !!all.length;
    clearSlot.replaceChildren(
      ...(all.length
        ? [
            confirmInPage({
              trigger: T.journalClear,
              question: T.journalClearAsk,
              confirm: T.journalClearYes,
              cancel: T.cancel,
              onConfirm: () => {
                try {
                  j.clear();
                } catch {
                  /* le journal se relit ci-dessous */
                }
                // 1.3.1 (PRD-1.3.1 § 12, B11) : les arrêts retenus de « j'y descends » sont oubliés avec le journal
                try {
                  ctx.glasses()?.forgetAlights?.();
                } catch {
                  /* lunettes indisponibles : rien à oublier ici */
                }
                paint();
                const left = trips().length;
                said.textContent = left ? '' : T.journalCleared;
                // la confirmation a disparu : le curseur passe à ce qui la remplace
                (left ? list.querySelector<HTMLElement>('button') : empty)?.focus();
              },
            }),
          ]
        : []),
    );
  };
  paint();

  return h(
    'section',
    { class: 'box journal', 'aria-labelledby': `${id}-titre` },
    h('h2', { id: `${id}-titre` }, T.journalTitle),
    h('p', { class: 'small' }, ctx.web ? T.journalLeadWeb : T.journalLead),
    list,
    empty,
    clearSlot,
    said,
  );
}

/** État d'une carte (« Disponible », « Indisponible ») : un point plein ou vide, puis le texte. */
function statusEl(text: string): HTMLSpanElement {
  return h('span', { class: 'status off' }, h('span', { class: 'dot off', 'aria-hidden': 'true' }), text);
}
function paintStatus(el: HTMLElement, s: { ok: boolean; text: string }): void {
  el.className = `status${s.ok ? '' : ' off'}`;
  el.replaceChildren(h('span', { class: `dot${s.ok ? '' : ' off'}`, 'aria-hidden': 'true' }), s.text);
}

export function dataScreen(ctx: PhoneCtx): HTMLElement {
  const live = liveRegion();
  const status = statusEl('Vérification…');
  const nets = h('ul', { class: 'list' });
  const updates = h('dl');
  const staleBox = h('div');
  const addrState = statusEl('…');
  const paintAddresses = (health: HealthResponse | null, checked: boolean): void => paintStatus(addrState, addressStatus(health, checked));
  // 1.2.5 : météo (Open-Meteo par le relais) : disponible, indisponible, ou coupée dans Affichage
  const weatherState = statusEl('…');
  const paintWeather = (w: 'ok' | 'down' | 'unknown' | 'off'): void => paintStatus(weatherState, weatherText(w));
  // 1.2.10 : chemins à pied (OpenStreetMap), calculés sur le téléphone ; sans cœur, indisponibles
  const walkState = statusEl('…');
  ctx.core().then(
    (c) => paintStatus(walkState, walkText(c)),
    () => paintStatus(walkState, walkText(null)),
  );
  const checkWeather = async (): Promise<void> => {
    if (ctx.settings.get().display.rain === false) return paintWeather('off');
    try {
      const core = await ctx.core();
      paintWeather(core.weather ? await core.weather() : 'unknown');
    } catch {
      paintWeather('down');
    }
  };
  const test = h('button', { type: 'button', class: 'btn btn-secondary btn-block', style: 'min-height:44px' }, 'Tester la connexion');

  const paintNets = (health: HealthResponse | null, meta: Meta | null): void => {
    nets.replaceChildren(
      ...NETS.map(({ op, label }) => {
        const src = health?.sources?.[op];
        const feed = meta?.feeds?.[op];
        const ok = !!src?.ok;
        const text = networkText(ok, feed, !!health);
        return h(
          'li',
          { class: 'net' },
          h('span', { class: 'n1' }, h('span', { class: `dot${ok ? '' : ' off'}`, 'aria-hidden': 'true' }), label),
          h('span', { class: `n2${ok ? '' : ' off'}` }, text),
        );
      }),
    );
  };

  const paintUpdates = (meta: Meta | null, health: HealthResponse | null = null): void => {
    const fresh = ctx.freshness();
    const now = ctx.clock.now();
    updates.replaceChildren(
      h('div', { class: 'kv' }, h('dt', null, 'Horaires officiels'), h('dd', null, meta ? generatedText(meta.generatedAt, now) : ctx.coreError() ?? '…')),
      h('div', { class: 'kv' }, h('dt', null, 'Trajets vers tes favoris'), h('dd', null, !meta ? '…' : fresh && !fresh.ok ? 'pas à jour' : 'prêts pour aujourd’hui')),
      h('div', { class: 'kv' }, h('dt', null, 'Temps réel'), h('dd', null, realtimeText(ctx.coreNow()?.status?.().rt, health))),
      h('div', { class: 'kv' }, h('dt', null, 'Version de Quai'), h('dd', null, APP_VERSION)),
    );
    staleBox.replaceChildren();
    if (fresh && !fresh.ok) {
      staleBox.appendChild(h('div', { class: 'warn', role: 'alert' }, h('strong', null, fresh.message ?? 'Horaires périmés'), h('span', null, STALE_HELP)));
    } else if (fresh?.message) {
      staleBox.appendChild(h('div', { class: 'warn' }, h('strong', null, fresh.message), h('span', null, STALE_HELP)));
    } else if (!ctx.configured) {
      staleBox.appendChild(h('div', { class: 'warn', role: 'alert' }, h('strong', null, 'Quai n’est pas configuré.'), h('span', null, 'Adresses des horaires et du relais absentes : « npm run configure » avant de créer le paquet.')));
    }
  };

  const check = async (manual: boolean): Promise<void> => {
    test.disabled = true;
    if (manual) live.say('Test en cours…');
    try {
      const core = await ctx.core();
      const health = await core.health();
      const ok = health.ok;
      paintStatus(status, { ok, text: ok ? 'Connecté' : 'Injoignable' });
      paintNets(health, ctx.meta());
      paintUpdates(ctx.meta(), health);
      paintAddresses(health, true);
      if (manual) live.say(typo(ok ? 'Connexion réussie : relais et sources répondent.' : 'Le relais répond, mais une source au moins est en panne.'), !ok);
    } catch (e) {
      paintStatus(status, { ok: false, text: 'Injoignable' });
      paintNets(null, ctx.meta());
      paintUpdates(ctx.meta());
      paintAddresses(null, true);
      live.say(typo(`Connexion impossible : ${e instanceof Error ? e.message : String(e)}`), true);
    } finally {
      test.disabled = false;
    }
  };
  test.addEventListener('click', () => {
    void check(true);
    void checkWeather();
  });
  paintNets(null, ctx.meta());
  paintUpdates(ctx.meta());
  void check(false);
  void checkWeather();

  return h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:14px' },
    header(ctx, T.data, undefined, { label: T.settings, hash: '#/reglages' }),
    staleBox,
    h(
      'section',
      { class: 'box', style: 'padding:14px 16px;display:flex;flex-direction:column;gap:8px' },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:12px' }, h('h2', null, 'Portail des opérateurs'), status),
      h('p', { class: 'small' }, 'Belgian Mobility Company : SNCB, STIB, De Lijn et TEC. Clé enregistrée à l’installation, dans ton relais.'),
      test,
      live.el,
    ),
    h('section', { class: 'box pad-tight' }, h('h2', { style: 'margin:0 0 4px' }, 'Réseaux'), nets),
    h(
      'section',
      { class: 'box', style: 'padding:14px 16px;display:flex;flex-direction:column;gap:6px' },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:12px' }, h('h2', null, 'Adresses'), addrState),
      h('p', { class: 'small' }, 'Services officiels de Bruxelles, de Flandre et de Wallonie'),
    ),
    // 1.2.5 (PRD-1.2.5 § 3) : météo (Open-Meteo, par le relais) : toute la Belgique d'un coup, jamais la position
    h(
      'section',
      { class: 'box', style: 'padding:14px 16px;display:flex;flex-direction:column;gap:6px' },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:12px' }, h('h2', null, 'Météo'), weatherState),
      h('p', { class: 'small' }, typo('Open-Meteo : la pluie prévue pendant tes marches. Quai reçoit la carte de toute la Belgique : ta position n’est jamais envoyée.')),
    ),
    // 1.2.10 (PRD-1.2.10 § 3.8) : chemins à pied d'OpenStreetMap, avec leur attribution (licence ODbL)
    h(
      'section',
      { class: 'box', style: 'padding:14px 16px;display:flex;flex-direction:column;gap:6px' },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:12px' }, h('h2', null, T.walkTitle), walkState),
      h('p', { class: 'small' }, typo(ctx.web ? T.walkTextWeb : T.walkText)),
      h('p', { class: 'small muted' }, T.walkCredit),
    ),
    h('section', { class: 'box pad-tight' }, h('h2', { style: 'margin:0 0 4px' }, 'Mises à jour'), updates),
    // 1.3.0 (PRD-1.3.0 § 6.4) : journal des trajets guidés, gardé sur le téléphone
    journalCard(ctx),
    h('p', { class: 'small muted' }, 'Si une source ne répond plus, Quai affiche l’horaire prévu, signalé par le signe ~. Usage personnel et non commercial.'),
    h('p', { class: 'small muted' }, typo(`Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company, licence CC BY 4.0. Météo : Open-Meteo.com, licence CC BY 4.0. ${addressAttribution().replace(/\.\s*$/, '')}.`)),
  );
}
