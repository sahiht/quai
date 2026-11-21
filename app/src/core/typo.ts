/**
 * 1.3.1 (PRD-1.3.1 § 7) : un nom venu des données (arrêt, gare, destination, ligne) s'affiche avec l'apostrophe
 * typographique : « Braine-l'Alleud, Gare » → « Braine-l’Alleud, Gare ». Seulement à l'affichage : comparaisons,
 * recherches et réglages enregistrés gardent le nom tel quel.
 */
export function apos(name: string): string {
  return name.indexOf("'") < 0 ? name : name.replace(/'/g, '’');
}

/**
 * 1.3.1 (décision du propriétaire, 20/11 à 21:15) : diminutif d'un nom trop long pour sa ligne, par exemple
 * « Bruxelles-Central » → « Bxl-Central ». Seulement à l'affichage, et seulement quand le nom entier ne tient pas :
 * l'appelant essaie d'abord le nom entier, puis `shortName`, puis la coupe au mot. Liste courte et sûre, mots entiers
 * seulement ; un nom sans mot de la liste revient tel quel.
 *
 * Contrôle technique final : pas de regard arrière (« lookbehind ») dans ces motifs. Safari et la WebView d'iOS avant la
 * 16.4 ne le connaissent pas et refusent le motif dès sa construction, au chargement de ce fichier : plus rien de Quai
 * ne s'ouvrait (lunettes, téléphone, Quai Web), alors que la 1.3.0 n'en avait aucun. Le début du mot se lit donc dans
 * un groupe (début du nom, ou un caractère qui n'est ni une lettre ni un chiffre), remis tel quel devant le diminutif.
 */
const SHORT_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  ['Bruxelles', 'Bxl'],
  ['Brussel', 'Bru.'],
  ['Sainte', 'Ste'],
  ['Saint', 'St'],
  ['Sint', 'St'],
  ['Boulevard', 'Bd'],
  ['Avenue', 'Av.'],
  ['Chaussée', 'Ch.'],
  ['Place', 'Pl.'],
].map(([word, short]) => [new RegExp(`(^|[^\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, 'gu'), short] as const);

export function shortName(name: string): string {
  let out = name;
  for (const [re, short] of SHORT_WORDS) out = out.replace(re, (_m, before: string) => `${before}${short}`);
  return out;
}
