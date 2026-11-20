/**
 * 1.3.1 (PRD-1.3.1 § 14, R1) : la ligne pâle de la sortie du métro sur l'écran de la marche après une descente (B17) :
 * « Sortie : Boulevard Anspach ». Le nom vient d'OpenStreetMap (data/exits.json) : apostrophe typographique à
 * l'affichage, nom coupé entre deux mots s'il est trop long (« Sortie : Allée Adrienne Gommers… »), jamais après un mot
 * de liaison ni au milieu d'un mot ; rien si même son premier mot ne tient pas.
 */
import { apos } from '../core/typo';
import { textWidth } from './font';
import { NB } from './format';

/** Début de la ligne, avec l'espace insécable avant les deux-points. */
export const EXIT_HEAD = `Sortie${NB}: `;

/** Mots qui ne finissent jamais un nom coupé (« Allée Adrienne Gommers &… », « Rue de la… »). */
const LINK = /\s+(?:&|et|de|du|des|d’|la|le|les|l’|au|aux|à|en|sur|van|von)$/i;

/** « Sortie : Boulevard Anspach » dans `maxPx` ; '' sans nom ou sans place pour un mot entier du nom. */
export function exitLineText(name: string | undefined, maxPx: number): string {
  const n = apos(name ?? '').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  const fits = (t: string): boolean => textWidth(`${EXIT_HEAD}${t}`) <= maxPx;
  if (fits(n)) return `${EXIT_HEAD}${n}`;
  const words = n.split(' ');
  // le plus de mots entiers qui tiennent, sans finir sur un mot de liaison
  for (let k = words.length - 1; k >= 1; k--) {
    let head = words.slice(0, k).join(' ');
    while (LINK.test(head)) head = head.replace(LINK, '');
    head = head.replace(/[\s,;:·/-]+$/, '');
    if (head && fits(`${head}…`)) return `${EXIT_HEAD}${head}…`;
  }
  return '';
}
