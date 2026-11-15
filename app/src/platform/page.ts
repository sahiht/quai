/**
 * 1.2.10 : règles d'une page des lunettes (limites du SDK 0.0.16), les mêmes sur toutes les plateformes : une image
 * refusée par l'appli Even l'est aussi dans Quai Web et dans le navigateur, pour que les tests le voient.
 */
import { IMAGE_MAX_H, IMAGE_MAX_W } from '../glasses/images';
import type { ContainerSpec, ImageSpec, MenuItem } from '../glasses/types';

/** Limites du SDK : 12 conteneurs, 8 texte, 4 image, nom de 16 caractères, menu de 10 choix de 32 octets. */
export const PAGE_LIMITS = { containers: 12, text: 8, images: 4, name: 16, menuItems: 10, menuBytes: 32 } as const;

const utf8 = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Conteneurs d'image recevables par le SDK : dimensions dans les limites (20..288 × 20..144, dans l'écran),
 * identifiant et nom uniques sur la page (textes compris), 4 au plus et 12 conteneurs en tout. Une image refusée
 * est écartée (journal) : la page reste valide, son texte suffit.
 */
export function pageImages(cs: readonly ContainerSpec[], images: readonly ImageSpec[] | undefined): ImageSpec[] {
  const ids = new Set(cs.map((c) => c.id));
  const names = new Set(cs.map((c) => c.name));
  const out: ImageSpec[] = [];
  for (const img of images ?? []) {
    const int = (v: number) => Number.isInteger(v);
    const ok =
      [img.id, img.x, img.y, img.w, img.h].every(int) &&
      img.w >= 20 &&
      img.w <= IMAGE_MAX_W &&
      img.h >= 20 &&
      img.h <= IMAGE_MAX_H &&
      img.x >= 0 &&
      img.y >= 0 &&
      img.x + img.w <= 576 &&
      img.y + img.h <= 288 &&
      typeof img.name === 'string' &&
      img.name.length > 0 &&
      img.name.length <= PAGE_LIMITS.name &&
      !ids.has(img.id) &&
      !names.has(img.name) &&
      out.length < PAGE_LIMITS.images &&
      cs.length + out.length < PAGE_LIMITS.containers;
    if (!ok) {
      console.warn('[Quai] conteneur d’image écarté', img.name, img.id);
      continue;
    }
    ids.add(img.id);
    names.add(img.name);
    out.push(img);
  }
  return out;
}

/** Libellé coupé à 32 octets UTF-8 (sur une limite de caractère, « … » ajouté). */
export function menuLabel(label: string): string {
  const t = String(label ?? '').trim();
  if (utf8(t) <= PAGE_LIMITS.menuBytes) return t;
  const chars = [...t];
  while (chars.length && utf8(`${chars.join('').trimEnd()}…`) > PAGE_LIMITS.menuBytes) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

/** Choix du menu recevables : identifiant uint32 non nul et unique, libellé non vide (coupé à 32 octets), 10 au plus. */
export function pageMenu(items: readonly MenuItem[] | undefined): MenuItem[] {
  const seen = new Set<number>();
  const out: MenuItem[] = [];
  for (const it of items ?? []) {
    const label = menuLabel(it.label);
    if (!Number.isInteger(it.id) || it.id <= 0 || it.id > 0xffff_ffff || seen.has(it.id) || !label || out.length >= PAGE_LIMITS.menuItems) {
      console.warn('[Quai] choix du menu écarté', it);
      continue;
    }
    seen.add(it.id);
    out.push({ id: it.id, label });
  }
  return out;
}
