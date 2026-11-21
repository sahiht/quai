/**
 * Quai 1.3.1, contrôle technique final : ce qui part du téléphone, tous sujets ensemble (vrai chemin dès l'accueil,
 * « Éviter les escaliers », sorties du métro, « dernier », rafraîchissement). Le vrai cœur sur le mini-réseau commun :
 * - seulement les deux serveurs de Quai (données publiées, relais), aucun autre ;
 * - seulement des fichiers publics connus ; la seule adresse nouvelle de la 1.3.1 est exits.json, sans paramètre ; les
 *   tuiles piétonnes (walk/) existaient en 1.2.10 pour le guidage, elles sont maintenant demandées dès l'accueil ;
 * - la position n'est dans aucune adresse (ni coordonnée, ni morceau de coordonnée).
 */
import { describe, expect, it } from 'vitest';
import { DATA_BASE, RELAY_BASE } from './support/env';
import { at, BOURSE, ESPLANADE, scene, settle, START, TILE, VERSION } from './vrai-chemin-scene';

/** Fichiers publiés que l'appli peut demander (chemin sous les données). */
const DATA_FILES: RegExp[] = [
  /^meta\.json$/,
  /^tiles\/-?\d+_-?\d+\.json$/,
  /^areas\/[a-z]+\/[A-Za-z0-9_.-]+\.json$/,
  /^search\/[a-z0-9]{2}\.json$/,
  /^trains\/\d{4}-\d{2}-\d{2}\.json$/,
  /^lines\/[A-Za-z0-9_./-]+\.json$/,
  /^linetiles\/-?\d+_-?\d+\.json$/,
  /^walk\/index\.json$/,
  /^walk\/\d+_\d+(_[0-3]{1,3})?\.json\?v=\d{4}-\d{2}-\d{2}$/,
  /^exits\.json$/,
];

describe('1.3.1, contrôle technique final : ce qui part du téléphone, tous sujets ensemble', () => {
  it('accueil, trajet, rafraîchissement, chemin sans marches, sorties du métro : deux serveurs, des fichiers publics, jamais la position', async () => {
    const sc = scene('long');
    const now = at('07:10');
    const core = sc.core(() => now);
    await core.init();
    const s = sc.settings({ avoidSteps: true });
    // accueil : la réponse du favori (première marche : tuiles piétonnes demandées), puis la recherche d'un trajet
    const a = await core.answer(BOURSE, START, s);
    await settle();
    const r = await core.route({ type: 'here' }, { type: 'place', placeId: 'bourse' }, now, s, START);
    await settle();
    expect(r.journeys.length).toBeGreaterThan(0);
    // trajet suivi : rafraîchissement (« dernier », temps réel), chemin du guidage, sorties du métro
    await core.refresh(a.plan?.journeys[0] ?? r.journeys[0], s);
    await core.walkRoute?.(START, ESPLANADE, { avoidSteps: true });
    expect(await core.walkExits?.()).toBeNull();
    await settle();

    const calls = sc.server.calls;
    expect(calls.length).toBeGreaterThan(3);
    // deux serveurs seulement
    expect(calls.filter((u) => !u.startsWith(`${DATA_BASE}/`) && !u.startsWith(`${RELAY_BASE}/`))).toEqual([]);
    // données : seulement des fichiers publics connus
    const data = calls.filter((u) => u.startsWith(`${DATA_BASE}/`)).map((u) => u.slice(DATA_BASE.length + 1));
    expect(data.filter((p) => !DATA_FILES.some((re) => re.test(p)))).toEqual([]);
    // la 1.3.1 demande bien ses fichiers : les tuiles piétonnes dès la réponse du favori, exits.json sans paramètre
    expect(data).toContain('walk/index.json');
    expect(data).toContain(`walk/${TILE}.json?v=${VERSION}`);
    expect(data.filter((p) => p.startsWith('exits'))).toEqual(['exits.json']);
    // la position : ni ses coordonnées, ni celles de l'arrêt ou du lieu, ni un nombre à décimales qui y ressemble
    const digits = (n: number): string[] => [n.toFixed(5), n.toFixed(4), n.toFixed(3)];
    const secret = [START.lat, START.lon, ESPLANADE.lat, ESPLANADE.lon, BOURSE.lat, BOURSE.lon].flatMap(digits);
    for (const u of calls) {
      const shown = decodeURIComponent(u);
      for (const d of secret) expect(shown, u).not.toContain(d);
      // aucun nombre à 3 décimales ou plus dans une adresse (une coordonnée), où que ce soit
      expect(shown.replace(DATA_BASE, '').replace(RELAY_BASE, ''), u).not.toMatch(/\d\.\d{3,}/);
      expect(shown, u).not.toMatch(/[?&](lat|lon|lng|latitude|longitude|pos|position|near|here|ll)=/i);
    }
  });
});
