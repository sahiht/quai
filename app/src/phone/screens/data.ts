/**
 * Réglage 6 sur 6 : données (T6, maquette Config6) : état du relais (/api/health) et des services d'adresses,
 * fraîcheur des horaires, temps réel, version de Quai.
 */
import type { HealthResponse, Meta } from '../../core/api';
import { brusselsParts, hhmm, localDate } from '../../core/util';
import type { Op } from '../../../../shared/types';
import { APP_VERSION } from '../../version';
import { header, type PhoneCtx } from '../app';
import { h, liveRegion } from '../dom';
import { addressAttribution } from '../field';
import { typo } from '../text';

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

export function dataScreen(ctx: PhoneCtx): HTMLElement {
  const live = liveRegion();
  const status = h('span', { class: 'status off' }, h('span', { class: 'dot off', 'aria-hidden': 'true' }), 'Vérification…');
  const nets = h('ul', { class: 'list' });
  const updates = h('dl');
  const staleBox = h('div');
  const addrState = h('span', { class: 'status off' }, h('span', { class: 'dot off', 'aria-hidden': 'true' }), '…');
  const paintAddresses = (health: HealthResponse | null, checked: boolean): void => {
    const a = addressStatus(health, checked);
    addrState.className = `status${a.ok ? '' : ' off'}`;
    addrState.replaceChildren(h('span', { class: `dot${a.ok ? '' : ' off'}`, 'aria-hidden': 'true' }), a.text);
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
      status.className = `status${ok ? '' : ' off'}`;
      status.replaceChildren(h('span', { class: `dot${ok ? '' : ' off'}`, 'aria-hidden': 'true' }), ok ? 'Connecté' : 'Injoignable');
      paintNets(health, ctx.meta());
      paintUpdates(ctx.meta(), health);
      paintAddresses(health, true);
      if (manual) live.say(typo(ok ? 'Connexion réussie : relais et sources répondent.' : 'Le relais répond, mais une source au moins est en panne.'), !ok);
    } catch (e) {
      status.className = 'status off';
      status.replaceChildren(h('span', { class: 'dot off', 'aria-hidden': 'true' }), 'Injoignable');
      paintNets(null, ctx.meta());
      paintUpdates(ctx.meta());
      paintAddresses(null, true);
      live.say(typo(`Connexion impossible : ${e instanceof Error ? e.message : String(e)}`), true);
    } finally {
      test.disabled = false;
    }
  };
  test.addEventListener('click', () => void check(true));
  paintNets(null, ctx.meta());
  paintUpdates(ctx.meta());
  void check(false);

  return h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:14px' },
    header(ctx, 'Données', undefined, { label: 'Accueil', hash: '#/' }),
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
    h('section', { class: 'box pad-tight' }, h('h2', { style: 'margin:0 0 4px' }, 'Mises à jour'), updates),
    h('p', { class: 'small muted' }, 'Si une source ne répond plus, Quai affiche l’horaire prévu, signalé par le signe ~. Usage personnel et non commercial.'),
    h('p', { class: 'small muted' }, typo(`Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company, licence CC BY 4.0. ${addressAttribution().replace(/\.\s*$/, '')}.`)),
  );
}
