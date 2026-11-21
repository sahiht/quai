/**
 * Échantillon stable pour les balayages de nuit : un identifiant sur `one` environ, toujours les mêmes d'une nuit à
 * l'autre (empreinte FNV-1a 32 bits de l'identifiant, sans hasard ni date), pour que deux bilans se comparent.
 */
export function inSample(key: string, one: number): boolean {
  if (!(one > 1)) return true;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % Math.floor(one) === 0;
}

/** Balayage complet demandé ? « complet », « 1 », « oui » ou « true » (casse ignorée) ; vide ou autre : contrôle léger. */
export function scanComplet(value: string | undefined): boolean {
  return /^(complet|1|oui|true)$/i.test((value ?? '').trim());
}
