import { describe, expect, it } from 'vitest';
import { handleAlerts } from '../lib/handlers.js';
import type { AlertsResponse } from '../lib/shared/types.js';
import { call, feedRoute, header, jsonBody, makeCtx, sec } from './helpers.js';

const alerts = (path: string, t = makeCtx()) => call<AlertsResponse>(handleAlerts, path, t.ctx);
const SNCB_ALERT = {
  id: 'sncb-works-ottignies',
  routes: [],
  stops: ['8811601'],
  header: { fr: 'Travaux à Ottignies : quelques minutes de retard possibles', nl: 'Werken in Ottignies: enkele minuten vertraging mogelijk' },
  active: [[sec('2026-11-09T00:00:00+01:00'), sec('2026-11-15T23:59:00+01:00')]],
  // 1.2.10 : cause et effet du flux (la description, identique au titre, n'est pas répétée)
  cause: 'MAINTENANCE',
  effect: 'SIGNIFICANT_DELAYS',
};

describe('/api/alerts (fixtures)', () => {
  it('SNCB sans filtre : alerte active, identifiants normalisés, traductions par langue', async () => {
    const r = await alerts('/api/alerts?op=sncb');
    expect(r.status).toBe(200);
    expect(r.body.op).toBe('sncb');
    expect(r.body.alerts).toEqual([SNCB_ALERT]);
  });

  it('filtre par arrêt : le quai, la gare ou la gare parente (S…) d’Ottignies correspondent', async () => {
    for (const stops of ['8811601', '8811601_2', 'S8811601', 'gs:nmbssncb:8811601_5']) {
      const r = await alerts(`/api/alerts?op=sncb&stops=${stops}`);
      expect(r.body.alerts.map((a) => a.id), stops).toEqual(['sncb-works-ottignies']);
    }
    const none = await alerts('/api/alerts?op=sncb&stops=8812005_9,8813003&routes=IC');
    expect(none.body.alerts).toEqual([]);
  });

  it('TEC : filtre par ligne (préfixe gr: accepté), traduction nl vide omise', async () => {
    const r = await alerts('/api/alerts?op=tec&routes=N4,gr:tec:N51');
    expect(r.body.alerts).toEqual([{
      id: 'tec-51-deviation',
      routes: ['N51'],
      stops: [],
      header: { fr: 'Ligne 51 déviée rue de Fer' },
      active: [[sec('2026-11-09T00:00:00+01:00'), sec('2026-11-20T23:59:00+01:00')]],
      cause: 'CONSTRUCTION',
      effect: 'DETOUR',
    }]);
    expect((await alerts('/api/alerts?op=tec&routes=N4')).body.alerts).toEqual([]);
  });

  it('De Lijn : flux sans alerte', async () => {
    const r = await alerts('/api/alerts?op=delijn&stops=308611');
    expect(r.body).toMatchObject({ op: 'delijn', alerts: [] });
    expect(r.body.error).toBeUndefined();
  });

  it('période terminée ou pas encore commencée : alerte absente', async () => {
    expect((await alerts('/api/alerts?op=sncb', makeCtx({ now: Date.parse('2026-11-25T08:00:00+01:00') }))).body.alerts).toEqual([]);
    expect((await alerts('/api/alerts?op=sncb', makeCtx({ now: Date.parse('2026-11-08T23:00:00+01:00') }))).body.alerts).toEqual([]);
  });
});

describe('/api/alerts : cas limites (flux construits)', () => {
  const NOW = 1794309000;
  const tr = (...t: [string, string?][]) => ({ translation: t.map(([text, language]) => (language === undefined ? { text } : { text, language })) });
  const feed = {
    header: header(),
    entity: [
      { id: 'sans-periode', alert: { informedEntity: [{ routeId: 'gr:delijn:232' }], headerText: tr(['Omleiding']) } },
      { id: 'ouverte', alert: { activePeriod: [{ start: NOW - 60 }], informedEntity: [{ stopId: 'gs:delijn:308611' }], headerText: tr(['Début seulement', 'fr-BE'], ['Alleen begin', 'NL']) } },
      { id: 'fin-seule', alert: { activePeriod: [{ end: NOW + 60 }], informedEntity: [{ stopId: '300120' }], headerText: tr(['Fin', 'fr'], ['Ende', 'de'], ['End', 'en'], ['Fin', 'es']) } },
      { id: 'passee', alert: { activePeriod: [{ start: NOW - 7200, end: NOW - 3600 }, { start: NOW + 3600 }], informedEntity: [{ routeId: '232' }], headerText: tr(['Passée', 'fr']) } },
      { id: 'deux-periodes', alert: { activePeriod: [{ start: NOW - 7200, end: NOW - 3600 }, { start: (NOW - 60) * 1000, end: (NOW + 60) * 1000 }], informedEntity: [{ routeId: '270' }], headerText: tr(['Ms', 'fr']) } },
      { id: 'reseau', alert: { informedEntity: [{ agencyId: 'DL' }], headerText: tr(['Staking', 'nl']) } },
      { id: 'voyage', alert: { informedEntity: [{ trip: { tripId: 'gt:delijn:702321230', routeId: 'gr:delijn:460' } }], headerText: tr([' '], ['Rit', 'nl']), descriptionText: tr(['Desc', 'nl']) } },
      { id: 'description', alert: { informedEntity: [{ routeId: '1' }], descriptionText: tr(['Seulement la description', 'fr']) } },
      { id: 'supprimee', isDeleted: true, alert: { informedEntity: [{ routeId: '232' }], headerText: tr(['x', 'fr']) } },
    ],
  };
  const route = feedRoute(feed);
  const ids = async (q: string) => (await alerts(`/api/alerts?op=delijn${q}`, makeCtx({ route }))).body.alerts.map((a) => a.id);

  it('actives maintenant ou sans période ; bornes absentes = 0 ; horodatages en ms convertis', async () => {
    const r = await alerts('/api/alerts?op=delijn', makeCtx({ route }));
    const byId = Object.fromEntries(r.body.alerts.map((a) => [a.id, a]));
    expect(Object.keys(byId)).toEqual(['sans-periode', 'ouverte', 'fin-seule', 'deux-periodes', 'reseau', 'voyage', 'description']);
    expect(byId['sans-periode'].active).toEqual([]);
    expect(byId.ouverte.active).toEqual([[NOW - 60, 0]]);
    expect(byId['fin-seule'].active).toEqual([[0, NOW + 60]]);
    expect(byId['deux-periodes'].active[1]).toEqual([NOW - 60, NOW + 60]);
  });

  it('langues : codes régionaux et majuscules, langue par défaut de l’opérateur, langues inconnues ignorées', async () => {
    const r = await alerts('/api/alerts?op=delijn', makeCtx({ route }));
    const byId = Object.fromEntries(r.body.alerts.map((a) => [a.id, a]));
    expect(byId['sans-periode'].header).toEqual({ nl: 'Omleiding' });
    expect(byId.ouverte.header).toEqual({ fr: 'Début seulement', nl: 'Alleen begin' });
    expect(byId['fin-seule'].header).toEqual({ fr: 'Fin', de: 'Ende', en: 'End' });
    expect(byId.voyage.header).toEqual({ nl: 'Rit' });
    expect(byId.description.header).toEqual({ fr: 'Seulement la description' });
    const tec = await alerts('/api/alerts?op=tec', makeCtx({ route }));
    expect(tec.body.alerts.find((a) => a.id === 'sans-periode')?.header).toEqual({ fr: 'Omleiding' });
  });

  it('1.2.5 : caractères invisibles de sens d’écriture retirés ; une traduction qui n’en contient que : ignorée', async () => {
    const bidi = feedRoute({
      header: header(),
      entity: [{ id: 'sens', alert: { informedEntity: [{ routeId: '9' }], headerText: tr(['\u202BDéviation\u202C \u200Erue Neuve\u200F', 'fr'], ['\u2066\u2069', 'nl']), descriptionText: tr(['\u2067Arrêt\u2069 déplacé', 'fr']) } }],
    });
    const r = await alerts('/api/alerts?op=delijn', makeCtx({ route: bidi }));
    expect(r.body.alerts[0].header).toEqual({ fr: 'Déviation rue Neuve' });
    expect(JSON.stringify(r.body)).not.toMatch(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/);
  });

  it('filtres : ligne, arrêt, ligne d’un voyage ; une alerte de tout le réseau concerne tous les filtres', async () => {
    expect(await ids('&routes=232')).toEqual(['sans-periode', 'reseau']);
    expect(await ids('&stops=308611')).toEqual(['ouverte', 'reseau']);
    expect(await ids('&routes=460')).toEqual(['reseau', 'voyage']);
    expect(await ids('&routes=999&stops=1')).toEqual(['reseau']);
  });

  it('source en erreur : 200, error en français, liste vide', async () => {
    const r = await alerts('/api/alerts?op=tec', makeCtx({ route: () => jsonBody({}, 502) }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ op: 'tec', alerts: [], error: 'Alertes TEC indisponibles : réponse HTTP 502 du portail' });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('paramètres invalides : 400', async () => {
    for (const q of ['', '?op=', '?op=stib', '?op=nmbs', `?op=tec&routes=${'x'.repeat(300)}`]) {
      const r = await alerts(`/api/alerts${q}`);
      expect(r.status, q).toBe(400);
      expect(typeof r.body.error).toBe('string');
    }
  });
});

/**
 * 1.2.10 (PRD-1.2.10 § 6) : formats réels du TEC (relevés le 12/11/2026 dans les réponses de Transitous, qui lisent le
 * même flux GTFS-RT) : titre « Lieu | Cause | Lignes », cause et effet renseignés ; trois alertes sans ligne ni arrêt
 * (agence seule : « Binche | Travaux réfection rue Zéphirin Fontaine | Ligne E44 » était posée sur tous les bus du TEC,
 * le W de Waterloo compris), d'autres rattachées à leur ligne.
 */
describe('/api/alerts 1.2.10 : cause, effet, description, portée, alertes à venir', () => {
  const NOW = 1794309000; // 2026-11-10T12:10:00+01:00 (horloge de makeCtx)
  const tr = (text: string, language = 'fr') => ({ translation: [{ text, language }] });
  const feed = {
    header: header(),
    entity: [
      {
        id: 'binche',
        alert: {
          activePeriod: [{ start: NOW - 86_400, end: NOW + 10 * 86_400 }],
          informedEntity: [{ agencyId: 'TEC' }],
          cause: 'CONSTRUCTION',
          effect: 'DETOUR',
          headerText: tr('Binche | Travaux réfection rue Zéphirin Fontaine | Ligne E44'),
          descriptionText: tr('En raison des travaux, la ligne E44 est déviée sans arrêt perturbé.'),
        },
      },
      {
        id: 'ceroux',
        alert: {
          informedEntity: [{ routeId: 'gr:tec:B0039-23353' }],
          cause: 'CONSTRUCTION',
          effect: 'MODIFIED_SERVICE',
          headerText: tr('Céroux | Travaux | Ligne 39'),
          descriptionText: tr(`Suite aux travaux qui ont lieu Grand Rue et Route de Beaumont à Céroux, certains arrêts ne sont pas desservis. ${'Arrêts non desservis : Beaumont. '.repeat(12)}`),
        },
      },
      {
        id: 'demain',
        alert: {
          activePeriod: [{ start: NOW + 3 * 3600, end: NOW + 5 * 3600 }],
          informedEntity: [{ stopId: 'gs:tec:Bwatgar1' }],
          cause: 'CONSTRUCTION',
          effect: 'STOP_MOVED',
          headerText: tr('Waterloo | Travaux | Ligne W'),
        },
      },
      { id: 'sans-cause', alert: { informedEntity: [{ routeId: 'N51' }], headerText: tr('Ligne 51 déviée rue de Fer') } },
      { id: 'lointaine', alert: { activePeriod: [{ start: NOW + 3 * 86_400 }], informedEntity: [{ stopId: 'Bwatgar1' }], headerText: tr('Waterloo | Travaux | Ligne W') } },
    ],
  };
  const route = feedRoute(feed);
  const get = async (q: string) => (await alerts(`/api/alerts?op=tec${q}`, makeCtx({ route }))).body.alerts as (AlertsResponse['alerts'][number] & { cause?: string; effect?: string; desc?: Record<string, string>; global?: boolean })[];

  it('alerte de l’agence seule : marquée global (l’appli décide), rendue pour tout filtre comme avant', async () => {
    const r = await get('&routes=B0536-23747&stops=Bwatgar1');
    const binche = r.find((a) => a.id === 'binche');
    expect(binche).toMatchObject({ global: true, routes: [], stops: [], cause: 'CONSTRUCTION', effect: 'DETOUR' });
    expect(binche?.header).toEqual({ fr: 'Binche | Travaux réfection rue Zéphirin Fontaine | Ligne E44' });
    expect(binche?.desc).toEqual({ fr: 'En raison des travaux, la ligne E44 est déviée sans arrêt perturbé.' });
    // une alerte rattachée à sa ligne n'est jamais « global »
    expect((await get('&routes=B0039-23353')).find((a) => a.id === 'ceroux')?.global).toBeUndefined();
  });

  it('cause et effet seulement s’ils sont dans le flux ; description coupée à 300 caractères', async () => {
    const all = await get('');
    const ceroux = all.find((a) => a.id === 'ceroux');
    expect(ceroux).toMatchObject({ cause: 'CONSTRUCTION', effect: 'MODIFIED_SERVICE', routes: ['B0039-23353'] });
    expect(ceroux?.desc?.fr.length).toBe(300);
    const plain = all.find((a) => a.id === 'sans-cause');
    expect(plain && 'cause' in plain).toBe(false);
    expect(plain && 'effect' in plain).toBe(false);
    expect(plain && 'desc' in plain).toBe(false);
  });

  it('until : aussi les alertes qui commencent avant cette heure (48 h au plus) ; sans until : actives maintenant', async () => {
    expect((await get('&stops=Bwatgar1')).map((a) => a.id)).toEqual(['binche']);
    expect((await get(`&stops=Bwatgar1&until=${NOW + 2 * 3600}`)).map((a) => a.id)).toEqual(['binche']);
    expect((await get(`&stops=Bwatgar1&until=${NOW + 4 * 3600}`)).map((a) => a.id)).toEqual(['binche', 'demain']);
    // une heure passée vaut maintenant ; au-delà de 48 h, ramenée à 48 h
    expect((await get(`&stops=Bwatgar1&until=${NOW - 3600}`)).map((a) => a.id)).toEqual(['binche']);
    expect((await get(`&stops=Bwatgar1&until=${NOW + 400 * 86_400}`)).map((a) => a.id)).toEqual(['binche', 'demain']);
    expect((await get(`&stops=Bwatgar1&until=${NOW + 4 * 86_400}`)).map((a) => a.id)).not.toContain('lointaine');
  });

  it('until invalide : 400 en français', async () => {
    for (const q of ['&until=demain', '&until=-5', '&until=1.5']) {
      const r = await alerts(`/api/alerts?op=tec${q}`, makeCtx({ route }));
      expect(r.status, q).toBe(400);
      expect(r.body.error).toMatch(/until/);
    }
  });
});
