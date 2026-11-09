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
