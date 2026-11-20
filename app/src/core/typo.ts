/**
 * 1.3.1 (PRD-1.3.1 § 7) : un nom venu des données (arrêt, gare, destination, ligne) s'affiche avec l'apostrophe
 * typographique : « Braine-l'Alleud, Gare » → « Braine-l’Alleud, Gare ». Seulement à l'affichage : comparaisons,
 * recherches et réglages enregistrés gardent le nom tel quel.
 */
export function apos(name: string): string {
  return name.indexOf("'") < 0 ? name : name.replace(/'/g, '’');
}
