/**
 * 1.2.10 (PRD-1.2.10 § 6) : alertes des opérateurs, pertinence et rédaction (core/alerts.ts, fonctions pures).
 * Titres, causes et effets réels du TEC et de De Lijn relevés le 12/11/2026 dans les réponses de Transitous (même flux
 * GTFS-RT que le portail BMC) ; SNCB et STIB d'après les formats documentés du relais (relay/README.md). Lieux publics
 * seulement (gares, arrêts).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALERT_MAX_CHARS,
  ALERT_MAX_PX,
  BOARD_BUDGET,
  BOARD_PREFIX,
  TRIP_BUDGET,
  activeDuring,
  alertMatch,
  atPlace,
  fitWords,
  fits,
  frenchText,
  isAllClear,
  linesInText,
  parseHeader,
  placeMatches,
  scopeTexts,
  stibMessageText,
  worksText,
  type AlertScope,
  type FeedAlert,
} from '../../src/core/alerts';
import { textWidth } from '../../src/glasses/font';
import { WIDTHS } from '../../src/glasses/layout';
import { APP_DIR } from './support/network';

const NB = ' ';
const nb = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ');
const at = (local: string) => Date.parse(`${local}:00+01:00`);
const sec = (local: string) => Math.floor(at(local) / 1000);
const T0 = at('2026-11-16T07:30');
const T1 = at('2026-11-16T08:10');
const FOREVER: [number, number][] = [[sec('2026-04-20T04:00'), sec('2199-12-31T23:00')]];

/** Alertes réelles du TEC (12/11/2026), telles que le relais 1.2.10 les rend. */
const BINCHE: FeedAlert = {
  id: 'binche',
  routes: [],
  stops: [],
  global: true,
  cause: 'CONSTRUCTION',
  effect: 'DETOUR',
  header: { fr: 'Binche | Travaux réfection rue Zéphirin Fontaine | Ligne E44' },
  desc: { fr: 'En raison des travaux, la ligne E44 est déviée sans arrêt perturbé.' },
  active: [[sec('2026-11-09T00:01'), sec('2026-11-20T23:59')]],
};
const LILLOIS: FeedAlert = {
  id: 'lillois',
  routes: [],
  stops: [],
  global: true,
  cause: 'CONSTRUCTION',
  effect: 'STOP_MOVED',
  header: { fr: "Gare de Lillois | Travaux | Proxibus Braine L'Alleud (203) " },
  desc: { fr: 'Suite aux travaux qui auront lieu à la gare de Lillois + Rue de la Libération, les autobus seront déviés comme suit' },
  active: FOREVER,
};
const SERAING: FeedAlert = {
  id: 'seraing',
  routes: [],
  stops: [],
  global: true,
  cause: 'ACCIDENT',
  effect: 'OTHER_EFFECT',
  header: { fr: 'Seraing | Accident | Ligne 111' },
  desc: { fr: "En raison d'un accident survenu en ligne, le proxibus de Seraing ne circule plus à partir du vendredi 20 mars." },
  active: FOREVER,
};
const NAMUR: FeedAlert = {
  id: 'namur',
  routes: [],
  stops: [],
  global: true,
  cause: 'CONSTRUCTION',
  effect: 'STOP_MOVED',
  header: { fr: 'Namur | Travaux | Lignes A, 1, 2, 3, 5 et 9' },
  desc: { fr: 'En raison de travaux à Namur, une déviation est mise en place sur les lignes A, 1, 2, 3, 5 et 9.' },
  active: [[sec('2026-11-16T00:01'), sec('2026-12-18T23:59')]],
};
const CEROUX: FeedAlert = {
  id: 'ceroux',
  routes: ['B0039-23353'],
  stops: [],
  cause: 'CONSTRUCTION',
  effect: 'MODIFIED_SERVICE',
  header: { fr: 'Céroux | Travaux | Ligne 39' },
  desc: { fr: "Suite aux travaux qui ont lieu Grand Rue et Route de Beaumont à Céroux, certains arrêts ne sont pas desservis du 26/02/24 et jusqu'à nouvel ordre." },
  active: FOREVER,
};
const REPRISE: FeedAlert = {
  id: 'reprise',
  routes: ['B0039-23353', 'B0029-23708'],
  stops: [],
  cause: 'OTHER_CAUSE',
  effect: 'OTHER_EFFECT',
  header: { fr: "Reprise de l'itinéraire habituel | Lignes 29 et 39 " },
  desc: { fr: 'Suite à la fin du chantier à Céroux, les lignes 29 et 39 reprendront leurs itinéraires et leurs horaires habituels.' },
  active: FOREVER,
};
/** « La Chapelle » à Braine-l'Alleud : arrêt supprimé et remplacé (lignes 39, 40, 75, 114 et 115). */
const CHAPELLE: FeedAlert = {
  id: 'chapelle',
  routes: ['B0039-23353', 'B0040-21810'],
  stops: ['Bbrlcha1', 'Bbrlcha2'],
  cause: 'CONSTRUCTION',
  effect: 'STOP_MOVED',
  header: { fr: "Braine-l'Alleud / Travaux / Lignes 39, 40, 75, 114 et 115" },
  desc: { fr: "Suite aux travaux à hauteur de l'arrêt « La Chapelle » à Braine-l'Alleud, l'arrêt sera supprimé et remplacé par l'arrêt « Mont-Saint-Pont »." },
  active: FOREVER,
};

/** Le trajet du constat du 14/11 : le W de Waterloo Eglise à Bruxelles Midi (arrêts publics de la ligne). */
const W_LEG: AlertScope = {
  op: 'tec',
  lines: ['W'],
  routes: ['B0536-23747'],
  stops: [
    { id: 'Bwategl1', name: 'Waterloo Eglise', end: true },
    { id: 'Brsgman1', name: 'Rhode-Saint-Genese Avenue du Manoir', end: false },
    { id: 'Bbxlmid1', name: 'Bruxelles Midi', end: true },
  ],
  names: ['Waterloo Eglise', 'Bruxelles Midi', 'Brussel Zuid'],
  from: T0,
  to: T1,
};
const tecLeg = (line: string, route: string, stops: [string, string, boolean][]): AlertScope => ({
  op: 'tec',
  lines: [line],
  routes: [route],
  stops: stops.map(([id, name, end]) => ({ id, name, end })),
  from: T0,
  to: T1,
});

describe('titres du TEC (« Lieu | Cause | Lignes »)', () => {
  it('lieu, cause et lignes de chaque format réel', () => {
    expect(parseHeader(BINCHE.header.fr!)).toEqual({ structured: true, place: 'Binche', cause: 'Travaux', lines: ['E44'] });
    expect(parseHeader(LILLOIS.header.fr!)).toEqual({ structured: true, place: 'Gare de Lillois', cause: 'Travaux', lines: ['203'] });
    expect(parseHeader(SERAING.header.fr!)).toEqual({ structured: true, place: 'Seraing', cause: 'Accident', lines: ['111'] });
    expect(parseHeader(NAMUR.header.fr!)).toEqual({ structured: true, place: 'Namur', cause: 'Travaux', lines: ['A', '1', '2', '3', '5', '9'] });
    expect(parseHeader(CHAPELLE.header.fr!)).toEqual({ structured: true, place: "Braine-l'Alleud", cause: 'Travaux', lines: ['39', '40', '75', '114', '115'] });
    expect(parseHeader('Court-Saint-Etienne | Travaux | Ligne 19')).toEqual({ structured: true, place: 'Court-Saint-Etienne', cause: 'Travaux', lines: ['19'] });
    // phrase libre (SNCB) : le lieu après « à »
    expect(parseHeader('Travaux à Ottignies : quelques minutes de retard possibles')).toEqual({ structured: false, place: 'Ottignies' });
    expect(parseHeader('Ligne 51 déviée rue de Fer')).toEqual({ structured: false });
  });

  it('lignes nommées dans une phrase', () => {
    expect(linesInText('En raison des travaux, la ligne E44 est déviée sans arrêt perturbé.')).toEqual(['E44']);
    expect(linesInText('les lignes 29 et 39 reprendront leurs itinéraires')).toEqual(['29', '39']);
    expect(linesInText('Tram 3 : arrêt déplacé')).toEqual([]);
  });

  it('lieu reconnu parmi les noms d’arrêts : mots significatifs, Saint et St, gare et article ignorés', () => {
    expect(placeMatches('Gare de Lillois', ['Lillois Gare'])).toBe(true);
    expect(placeMatches('Court-Saint-Etienne', ['Court-St-Etienne Gare'])).toBe(true);
    expect(placeMatches("Braine-l'Alleud", ['Braine-l’Alleud Collège - Gare AB'])).toBe(true);
    expect(placeMatches('Binche', W_LEG.names!)).toBe(false);
    expect(placeMatches('Namur', ['Charleroi Sud', 'Gosselies Place'])).toBe(false);
    // un mot entier : « Ath » n'est pas « Athus »
    expect(placeMatches('Ath', ['Athus Gare'])).toBe(false);
    expect(placeMatches('Gare', ['Namur Gare'])).toBe(false);
  });
});

describe('pertinence : seules les alertes du trajet (ses lignes, ses arrêts, ses heures)', () => {
  it('constat du 14/11 : « Binche | Travaux réfection rue Zéphirin Fontaine | Ligne E44 » ne concerne pas le W Waterloo → Bruxelles', () => {
    expect(alertMatch(BINCHE, W_LEG)).toBeNull();
    expect(scopeTexts([BINCHE, LILLOIS, SERAING, NAMUR, CEROUX, REPRISE, CHAPELLE], W_LEG)).toEqual([]);
  });

  it('la même alerte sur l’E44 à Binche : rattachée par la ligne et le lieu, « Travaux : déviation à Binche »', () => {
    const e44 = tecLeg('E44', 'H0E44-00000', [['H1bigar1', 'Binche Gare', true], ['H1bizep1', 'Binche Rue Zéphirin Fontaine', true]]);
    expect(alertMatch(BINCHE, e44)).toEqual({ by: 'text' });
    expect(nb(worksText(BINCHE, { by: 'text' }))).toBe('Travaux : déviation à Binche');
  });

  it('TEC, numéro partagé par plusieurs régions : le « 1 » de Namur n’est pas celui de Charleroi', () => {
    const namur1 = tecLeg('1', 'N2010-21947', [['N508aga', 'Namur Gare', true], ['N509aaa', 'Namur Place Léopold', true]]);
    const charleroi1 = tecLeg('1', 'C0001-21650', [['Cchsud01', 'Charleroi Sud', true], ['Cgoplac1', 'Gosselies Place', true]]);
    expect(alertMatch(NAMUR, namur1)).toEqual({ by: 'text' });
    expect(alertMatch(NAMUR, charleroi1)).toBeNull();
    expect(nb(scopeTexts([NAMUR], namur1)[0])).toBe('Travaux : arrêt déplacé à Namur');
  });

  it('proxibus : la ligne entre parenthèses, le lieu « Gare de … » écrit « à la gare de … »', () => {
    const proxi = tecLeg('203', 'B0203-00000', [['Blilgar1', 'Lillois Gare', true], ['Bbrlgar1', 'Braine-l’Alleud Gare', true]]);
    expect(alertMatch(LILLOIS, proxi)).toEqual({ by: 'text' });
    expect(nb(scopeTexts([LILLOIS], proxi)[0])).toBe('Travaux : arrêt déplacé à la gare de Lillois');
    expect(alertMatch(LILLOIS, W_LEG)).toBeNull();
    expect(alertMatch(SERAING, W_LEG)).toBeNull();
  });

  it('alerte rattachée à la ligne (route_id) : oui pour la ligne 39, non pour une autre ligne du même lieu', () => {
    const l39 = tecLeg('39', 'B0039-23353', [['Bottgar1', 'Ottignies Gare', true], ['Bcerpla1', 'Céroux-Mousty Place', true]]);
    expect(alertMatch(CEROUX, l39)).toEqual({ by: 'route' });
    expect(nb(worksText(CEROUX, { by: 'route' }))).toBe('Travaux : arrêts non desservis à Céroux');
    expect(alertMatch(CEROUX, tecLeg('29', 'B0029-23708', [['Bottgar1', 'Ottignies Gare', true]]))).toBeNull();
    expect(alertMatch(CEROUX, W_LEG)).toBeNull();
  });

  it('fin de perturbation (« Reprise de l’itinéraire habituel ») : jamais montrée', () => {
    const l39 = tecLeg('39', 'B0039-23353', [['Bottgar1', 'Ottignies Gare', true]]);
    expect(isAllClear(REPRISE)).toBe(true);
    expect(alertMatch(REPRISE, l39)).toBeNull();
    expect(isAllClear({ ...CEROUX, effect: 'NO_EFFECT' })).toBe(true);
    expect(isAllClear(CEROUX)).toBe(false);
  });

  it('arrêt déplacé ailleurs sur la ligne : non ; à l’arrêt où l’on monte : oui, avec son nom', () => {
    const passing = tecLeg('39', 'B0039-23353', [['Bottgar1', 'Ottignies Gare', true], ['Bwavgar1', 'Wavre Gare', true]]);
    expect(alertMatch(CHAPELLE, passing)).toBeNull();
    const boarding = tecLeg('39', 'B0039-23353', [['Bbrlcha1', 'La Chapelle', true], ['Bottgar1', 'Ottignies Gare', true]]);
    expect(alertMatch(CHAPELLE, boarding)).toEqual({ by: 'end', stop: 'La Chapelle' });
    expect(nb(scopeTexts([CHAPELLE], boarding)[0])).toBe('Travaux : arrêt La Chapelle déplacé');
    // traversé sans y monter : un arrêt déplacé ne change rien au trajet
    const through = tecLeg('39', 'B0039-23353', [['Bottgar1', 'Ottignies Gare', true], ['Bbrlcha2', 'La Chapelle', false], ['Bwavgar1', 'Wavre Gare', true]]);
    expect(alertMatch(CHAPELLE, through)).toBeNull();
  });

  it('heures : seulement une alerte active pendant l’étape (ni finie avant, ni commençant après)', () => {
    const evening: FeedAlert = { ...CEROUX, active: [[sec('2026-11-16T18:00'), sec('2026-11-16T20:00')]] };
    const l39 = tecLeg('39', 'B0039-23353', [['Bottgar1', 'Ottignies Gare', true]]);
    expect(alertMatch(evening, l39)).toBeNull();
    expect(alertMatch(evening, { ...l39, from: at('2026-11-16T19:00'), to: at('2026-11-16T19:30') })).toEqual({ by: 'route' });
    // commence pendant l'étape, finit pendant l'étape
    expect(alertMatch({ ...CEROUX, active: [[sec('2026-11-16T08:00'), 0]] }, l39)).toEqual({ by: 'route' });
    expect(alertMatch({ ...CEROUX, active: [[0, sec('2026-11-16T07:35')]] }, l39)).toEqual({ by: 'route' });
    expect(alertMatch({ ...CEROUX, active: [[0, sec('2026-11-16T07:29')]] }, l39)).toBeNull();
    expect(activeDuring({ active: [] }, T0, T1)).toBe(true);
    expect(activeDuring({ active: [[sec('2026-11-15T07:00'), sec('2026-11-15T08:00')], [sec('2026-11-16T08:05'), 0]] }, T0, T1)).toBe(true);
  });

  it('alerte sans ligne ni arrêt et sans lieu : seulement si elle vaut pour tout le réseau (grève, jour férié)', () => {
    const strike: FeedAlert = { id: 's', routes: [], stops: [], global: true, cause: 'STRIKE', effect: 'REDUCED_SERVICE', header: { nl: 'Staking: beperkte dienstverlening' }, active: [] };
    const dl: AlertScope = { op: 'delijn', lines: ['1'], routes: ['10010'], stops: [{ id: '101000', name: 'Wilrijk A. Chantrainestraat', end: true }], from: T0, to: T1 };
    expect(alertMatch(strike, dl)).toEqual({ by: 'text' });
    expect(nb(scopeTexts([strike], dl)[0])).toBe('Grève : service réduit');
    const vague: FeedAlert = { id: 'v', routes: [], stops: [], global: true, header: { fr: 'Travaux réfection rue Zéphirin Fontaine' }, active: [] };
    expect(alertMatch(vague, W_LEG)).toBeNull();
    // une ligne nommée sans lieu : un même numéro existe dans plusieurs régions, on ne peut pas savoir
    const line36: FeedAlert = { id: 'l', routes: [], stops: [], global: true, effect: 'DETOUR', header: { fr: 'La ligne 36 est déviée' }, active: [] };
    expect(alertMatch(line36, tecLeg('36', 'B0036-23712', [['Bwategl1', 'Waterloo Eglise', true]]))).toBeNull();
    const greve: FeedAlert = { id: 'g', routes: [], stops: [], global: true, header: { fr: 'Grève nationale le 26/11 : trafic fortement perturbé' }, active: [] };
    expect(alertMatch(greve, W_LEG)).toEqual({ by: 'text' });
    expect(nb(scopeTexts([greve], W_LEG)[0])).toBe('Grève nationale le 26/11 : trafic fortement…');
  });

  it('SNCB : gare de montée, gare traversée (effet sur le parcours seulement), quai et gare confondus', () => {
    const ic: AlertScope = {
      op: 'sncb',
      lines: ['IC'],
      routes: [],
      stops: [
        { id: '8863008', name: 'Namur', end: true },
        { id: '8811601', name: 'Ottignies', end: false },
        { id: '8813003', name: 'Bruxelles-Central', end: true },
      ],
      from: T0,
      to: T1,
    };
    const ott: FeedAlert = { id: 'o', routes: [], stops: ['8811601'], cause: 'MAINTENANCE', effect: 'SIGNIFICANT_DELAYS', header: { fr: 'Travaux à Ottignies : quelques minutes de retard possibles' }, active: [] };
    expect(alertMatch(ott, ic)).toEqual({ by: 'via', stop: 'Ottignies' });
    expect(nb(scopeTexts([ott], ic)[0])).toBe('Travaux : retards possibles à Ottignies');
    const lift: FeedAlert = { id: 'a', routes: [], stops: ['8811601_3'], cause: 'TECHNICAL_PROBLEM', effect: 'ACCESSIBILITY_ISSUE', header: { fr: 'Ascenseur du quai 3 hors service' }, active: [] };
    expect(alertMatch(lift, ic)).toBeNull();
    const liftCentral = { ...lift, stops: ['S8813003'] };
    expect(alertMatch(liftCentral, ic)).toEqual({ by: 'end', stop: 'Bruxelles-Central' });
    // « Problème technique : accès difficile à Bruxelles-Central » ne tient pas : la phrase de l'opérateur, plus précise
    expect(nb(scopeTexts([liftCentral], ic)[0])).toBe('Ascenseur du quai 3 hors service');
  });

  it('De Lijn : titre vague (« Perturbation inattendue ») : l’effet et l’arrêt, sinon la description', () => {
    const dl: FeedAlert = {
      id: 'dl',
      routes: [],
      stops: ['200553'],
      cause: 'ACCIDENT',
      effect: 'REDUCED_SERVICE',
      header: { fr: 'Perturbation inattendue' },
      desc: { fr: 'T1 : Quai 1 supprimé. Tram T1 vers Expo au quai 1 bis' },
      active: [],
    };
    const leg: AlertScope = { op: 'delijn', lines: ['1'], routes: ['21010'], stops: [{ id: '200553', name: 'Gent Sint-Pieters', end: true }], from: T0, to: T1 };
    expect(nb(scopeTexts([dl], leg)[0])).toBe('Accident : service réduit à Gent Sint-Pieters');
    // sans effet du flux : la première phrase de la description
    expect(nb(scopeTexts([{ ...dl, effect: undefined, cause: undefined }], leg)[0])).toBe('T1 : Quai 1 supprimé');
  });
});

describe('rédaction : « Travaux : … » court et utile, 48 caractères, au pixel', () => {
  const all: [FeedAlert, AlertScope][] = [
    [BINCHE, tecLeg('E44', 'H0E44-00000', [['H1bigar1', 'Binche Gare', true]])],
    [LILLOIS, tecLeg('203', 'B0203-00000', [['Blilgar1', 'Lillois Gare', true]])],
    [NAMUR, tecLeg('1', 'N2010-21947', [['N508aga', 'Namur Gare', true]])],
    [CEROUX, tecLeg('39', 'B0039-23353', [['Bottgar1', 'Ottignies Gare', true]])],
    [CHAPELLE, tecLeg('39', 'B0039-23353', [['Bbrlcha1', 'Braine-l’Alleud La Chapelle Rue de la Station', true]])],
  ];

  it('jamais de « | », de tiret long ou moyen ; espace insécable devant « : » ; tient dans la ligne du haut', () => {
    for (const [a, s] of all) {
      const texts = scopeTexts([a], s);
      expect(texts.length, a.id).toBe(1);
      for (const t of texts) {
        expect(t).not.toMatch(/[|–—]/);
        expect(t).not.toMatch(/ :/);
        expect(t).toContain(`${NB}:`);
        expect([...t].length).toBeLessThanOrEqual(ALERT_MAX_CHARS);
        expect(textWidth(t)).toBeLessThanOrEqual(ALERT_MAX_PX);
        expect(t.endsWith('…')).toBe(false);
      }
    }
    expect(ALERT_MAX_PX).toBe(WIDTHS.full);
  });

  it('nom d’arrêt trop long pour « arrêt … déplacé » : le texte court, jamais coupé dans un mot', () => {
    const [a, s] = all[4];
    expect(nb(scopeTexts([a], s)[0])).toBe("Travaux : arrêt déplacé à Braine-l'Alleud");
  });

  it('tableaux et détail d’une ligne : la place du « ! » des écrans', () => {
    const long: FeedAlert = { id: 'x', routes: ['B0039-23353'], stops: [], header: { fr: 'Ligne 39 : arrêts Beaumont Place de Renival et Habitation 54 non desservis' }, active: [] };
    const t = worksText(long, { by: 'route' }, BOARD_BUDGET)!;
    expect(fits(`${BOARD_PREFIX}${t}`, TRIP_BUDGET)).toBe(true);
    expect(t.endsWith('…')).toBe(true);
    expect(nb(t)).toBe('Ligne 39 : arrêts Beaumont Place de Renival…');
  });

  it('phrase libre trop longue : coupée à une fin de mot, jamais après un petit mot', () => {
    // « … de retard… » ferait 49 caractères ; « … minutes de… » finirait sur un petit mot
    expect(fitWords('Travaux à Ottignies : quelques minutes de retard possibles')).toBe('Travaux à Ottignies : quelques minutes…');
    expect(fitWords('Déviation de la ligne entre la place Saint-Lambert et la gare des Guillemins')).toBe('Déviation de la ligne entre la place…');
    expect(fitWords('Court')).toBe('Court');
    expect(fitWords('x'.repeat(60))).toBe('');
  });

  it('« à Binche », « à la gare de Lillois », « rue de Fer » sans préposition', () => {
    expect(atPlace('Binche')).toBe('à Binche');
    expect(atPlace('Gare de Lillois')).toBe('à la gare de Lillois');
    expect(atPlace('Rue de Fer')).toBe('rue de Fer');
    expect(atPlace('Place Saint-Lambert')).toBe('place Saint-Lambert');
  });

  it('effet lu dans le texte : jamais attribué à l’arrêt où l’on monte (« arrêt Botanique non desservi » vu à Rogier)', () => {
    const msg: FeedAlert = { id: 'm', routes: [], stops: ['6359'], header: { fr: 'Travaux : arrêt Botanique non desservi' }, active: [] };
    const t = worksText(msg, { by: 'end', stop: 'Rogier' });
    expect(nb(t)).toBe('Travaux : arrêt Botanique non desservi');
  });

  it('messages STIB : la phrase de l’opérateur, nettoyée, coupée à une fin de mot', () => {
    expect(stibMessageText('Travaux : arrêt Botanique non desservi')).toBe(`Travaux${NB}: arrêt Botanique non desservi`);
    expect(stibMessageText('travaux  –  arrêt   Yser‎ déplacé')).toBe('Travaux, arrêt Yser déplacé');
    expect(stibMessageText('Suite à des travaux, les trams 3 et 4 ne desservent pas les arrêts Rogier et Gare du Nord')).toBe('Suite à des travaux, les trams 3 et 4…');
    expect(stibMessageText('   ')).toBeNull();
  });
});

describe('autres cas', () => {
  it('SNCB, alerte sans arrêt (agence seule) qui nomme sa gare : seulement pour un train qui y passe', () => {
    const ott: FeedAlert = { id: 'o', routes: [], stops: [], global: true, cause: 'MAINTENANCE', effect: 'SIGNIFICANT_DELAYS', header: { fr: 'Travaux à Ottignies : quelques minutes de retard possibles' }, active: [] };
    const through: AlertScope = { op: 'sncb', lines: ['IC'], routes: [], stops: [{ id: '8863008', name: 'Namur', end: true }, { id: '8811601', name: 'Ottignies', end: false }, { id: '8813003', name: 'Bruxelles-Central', end: true }], from: T0, to: T1 };
    const elsewhere: AlertScope = { ...through, stops: [{ id: '8841004', name: 'Liège-Guillemins', end: true }, { id: '8844008', name: 'Verviers-Central', end: true }] };
    expect(nb(scopeTexts([ott], through)[0])).toBe('Travaux : retards possibles à Ottignies');
    expect(alertMatch(ott, elsewhere)).toBeNull();
  });

  it('titre « Lieu | Cause » sans effet : « Manifestation à Bruxelles » si le trajet y passe', () => {
    const demo: FeedAlert = { id: 'd', routes: [], stops: [], global: true, header: { fr: 'Bruxelles | Manifestation' }, active: [] };
    expect(nb(scopeTexts([demo], W_LEG)[0])).toBe('Manifestation à Bruxelles');
    expect(alertMatch(demo, tecLeg('1', 'N2010-21947', [['N508aga', 'Namur Gare', true]]))).toBeNull();
  });

  it('compatibilité des WebView : aucune expression régulière à « lookbehind » dans core/alerts.ts', () => {
    expect(readFileSync(join(APP_DIR, 'src', 'core', 'alerts.ts'), 'utf8')).not.toMatch(/\(\?<[=!]/);
  });
});

/**
 * Vraies données (facultatif) : chaque nom d'arrêt et de gare publié, dans les textes qui le nomment.
 *   QUAI_REAL_DATA=/home/claude/real-data-13/data npx vitest run test/core/alerts.test.ts
 */
const REAL = process.env.QUAI_REAL_DATA && process.env.QUAI_REAL_DATA !== '1' ? process.env.QUAI_REAL_DATA : '/home/claude/real-data-13/data';
const realEnabled = !!process.env.QUAI_REAL_DATA && existsSync(join(REAL, 'meta.json'));

describe.skipIf(!realEnabled)('données réelles : tous les noms d’arrêts tiennent, jamais coupés dans un mot', () => {
  it('« arrêt X déplacé », « déviation à X », « retards possibles à X » : 48 caractères, au pixel, le nom entier ou rien', () => {
    const names = new Map<string, string>();
    for (const f of readdirSync(join(REAL, 'tiles'))) {
      const tile = JSON.parse(readFileSync(join(REAL, 'tiles', f), 'utf8')) as { areas?: { id: string; op: string; n: { fr: string; nl: string } }[] };
      for (const a of tile.areas ?? []) for (const n of [a.n.fr, a.n.nl]) if (n) names.set(n, a.op);
    }
    expect(names.size).toBeGreaterThan(20_000);
    // cause, effet, forme courte quand le nom ne tient pas
    const kinds: [string, string, string][] = [
      ['CONSTRUCTION', 'STOP_MOVED', 'Travaux : arrêt déplacé'],
      ['CONSTRUCTION', 'DETOUR', 'Travaux : déviation'],
      ['MAINTENANCE', 'SIGNIFICANT_DELAYS', 'Travaux : retards possibles'],
      ['TECHNICAL_PROBLEM', 'ACCESSIBILITY_ISSUE', 'Problème technique : accès difficile'],
      ['DEMONSTRATION', 'NO_SERVICE', 'Manifestation : service interrompu'],
    ];
    let named = 0;
    let checked = 0;
    for (const [name, op] of names) {
      for (const [cause, effect, short] of kinds) {
        // titre vague (« Perturbation ») : seul l'arrêt du trajet peut nommer le lieu
        const a: FeedAlert = { id: 'r', routes: [], stops: ['x'], cause, effect, header: { fr: 'Perturbation' }, active: [] };
        for (const b of [TRIP_BUDGET, BOARD_BUDGET]) {
          const t = worksText(a, { by: 'end', stop: name }, b);
          checked++;
          expect(t, `${op} ${name}`).toBeTruthy();
          expect([...t!].length, t!).toBeLessThanOrEqual(b.maxChars);
          expect(textWidth(t!), t!).toBeLessThanOrEqual(b.maxPx);
          expect(t!).not.toMatch(/[|–—]/);
          expect(t!.endsWith('…'), t!).toBe(false);
          // le nom entier, ou la forme courte : jamais un morceau de nom
          if (nb(t).includes(nb(frenchText(name)))) named++;
          else expect(nb(t), `${op} ${name}`).toBe(short);
        }
      }
    }
    // 13/11 : 37,6 % des textes gardent le nom (« Travaux : arrêt Namur Gare déplacé »), les autres la forme courte
    expect(named / checked).toBeGreaterThan(0.3);
  }, 300_000);
});
