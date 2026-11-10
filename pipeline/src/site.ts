/** Page d'état publiée avec les données (site/index.html) et texte de licence (LICENSE-DATA.txt). */
import type { Meta, Op } from '../../shared/types.ts';
import { ddmm } from './cache.ts';
import { OP_LABEL, OPS } from './config.ts';

export const ATTRIBUTION = 'Données : SNCB, STIB, De Lijn, TEC via Belgian Mobility Company, licence CC BY 4.0';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function frenchDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-BE', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(new Date(iso));
}

/** « 2026-11-10 » -> « mardi 10 novembre 2026 ». */
export function frenchDay(date: string): string {
  return new Intl.DateTimeFormat('fr-BE', { dateStyle: 'full', timeZone: 'Europe/Brussels' }).format(new Date(`${date}T12:00:00Z`));
}

/** Espace insécable avant les deux-points (typographie française), dans un texte déjà échappé. */
function nbsp(html: string): string {
  return html.replace(/ :/g, '&nbsp;:');
}

const nf = new Intl.NumberFormat('fr-BE');

/** État d'un réseau sur la page : « à jour », repli sur un GTFS gardé, ou erreur. */
export function feedState(f: Meta['feeds'][Op]): string {
  if (!f.ok) return `en erreur : ${f.error ?? 'raison inconnue'}`;
  if (f.cachedFrom) return `horaires du ${ddmm(f.cachedFrom)}, le portail n’a pas répondu cette nuit`;
  return 'à jour';
}

/** Chemin de Quai Web à côté des données (dossier app/ publié par le flux de nuit, à côté de data/). */
export const WEB_APP_PATH = 'app/';

/** Page HTML minimale, en français : date de génération, état de chaque réseau, lien vers Quai Web, attribution. */
export function statusPage(meta: Meta, dataPath = 'data', webPath = WEB_APP_PATH): string {
  const rows = OPS.map((op: Op) => {
    const f = meta.feeds[op];
    const state = nbsp(esc(feedState(f)));
    return `      <tr><th scope="row">${OP_LABEL[op]}</th><td>${state}</td><td>${nf.format(f.areas)}</td><td>${nf.format(f.trips)}</td><td>${esc(f.feedVersion ?? '')}</td></tr>`;
  }).join('\n');
  const allOk = OPS.every((op) => meta.feeds[op].ok);
  const anyCached = OPS.some((op) => meta.feeds[op].ok && meta.feeds[op].cachedFrom);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Quai&nbsp;: données de transport</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; max-width: 44rem; margin: 2rem auto; padding: 0 1rem; color: #222; line-height: 1.5; }
    h1 { font-size: 1.6rem; font-weight: normal; border-bottom: 1px solid #999; padding-bottom: .3rem; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid #ddd; vertical-align: top; }
    td:nth-child(3), td:nth-child(4) { text-align: right; }
    .small { font-size: .9rem; color: #555; }
    .web { margin: 1.4rem 0; padding: .8rem 1rem; border: 1px solid #ccc; border-radius: 6px; }
    .web a { font-weight: bold; color: #1f5e37; }
  </style>
</head>
<body>
  <h1>Quai&nbsp;: données de transport</h1>
  <p>Données générées le ${esc(frenchDateTime(meta.generatedAt))} (heure de Bruxelles), pour les journées du ${esc(meta.serviceDates.map(frenchDay).join(' et du '))}.</p>
  <p>${!allOk ? 'Certains réseaux sont en erreur&nbsp;: leurs données ne sont pas publiées cette nuit.' : anyCached ? 'Tous les réseaux sont publiés&nbsp;; certains reprennent les horaires d’une nuit précédente.' : 'Tous les réseaux sont à jour.'}</p>
  <table>
    <thead>
      <tr><th scope="col">Réseau</th><th scope="col">État</th><th scope="col">Zones</th><th scope="col">Voyages</th><th scope="col">Version du flux</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p class="web"><a href="${esc(webPath)}">Ouvrir Quai Web</a>&nbsp;: Quai dans le navigateur, sans les lunettes (sur le téléphone, ajoute la page à l’écran d’accueil).</p>
  <p>${nbsp(esc(ATTRIBUTION))} (<a href="https://creativecommons.org/licenses/by/4.0/deed.fr">texte de la licence</a>).</p>
  <p class="small">Fichiers&nbsp;: <a href="${esc(dataPath)}/meta.json">${esc(dataPath)}/meta.json</a>, <a href="${esc(dataPath)}/LICENSE-DATA.txt">${esc(dataPath)}/LICENSE-DATA.txt</a>.</p>
</body>
</html>
`;
}

export function licenseText(meta: Meta): string {
  const versions = OPS.filter((op) => meta.feeds[op].ok)
    .map((op) => `  ${OP_LABEL[op]} : ${meta.feeds[op].feedVersion ? `version ${meta.feeds[op].feedVersion}` : 'version non indiquée'}${meta.feeds[op].cachedFrom ? ` (GTFS du ${ddmm(meta.feeds[op].cachedFrom as string)})` : ''}`)
    .join('\n');
  return `Quai : données de transport en commun

${ATTRIBUTION}.

Les fichiers de ce dossier sont dérivés des horaires officiels (GTFS) publiés par la SNCB, la STIB,
De Lijn et le TEC sur le portail de la Belgian Mobility Company. Ils sont diffusés sous la même licence :
Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/

Modifications : sélection des journées du ${meta.serviceDates.map(frenchDay).join(' et du ')},
regroupement des arrêts en zones, mise en forme des noms, conversion au format JSON de l'appli Quai.
Généré le ${frenchDateTime(meta.generatedAt)} (heure de Bruxelles), soit ${meta.generatedAt}.
${versions ? `\nFlux utilisés :\n${versions}\n` : ''}`;
}
