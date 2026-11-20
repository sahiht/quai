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
].map(([word, short]) => [new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, 'gu'), short] as const);

export function shortName(name: string): string {
  let out = name;
  for (const [re, short] of SHORT_WORDS) out = out.replace(re, short);
  return out;
}
