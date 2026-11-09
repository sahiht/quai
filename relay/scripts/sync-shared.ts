/**
 * npm run sync-shared : recopie ../shared/types.ts dans lib/shared/ pour que le dossier relay/ se suffise
 * à lui-même sur Vercel (Root Directory = relay). Un test vérifie que la copie est identique.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHARED_FILES = ['types.ts'] as const;

const here = dirname(fileURLToPath(import.meta.url));
export const SHARED_SRC = join(here, '..', '..', 'shared');
export const SHARED_DEST = join(here, '..', 'lib', 'shared');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(SHARED_DEST, { recursive: true });
  for (const f of SHARED_FILES) {
    const from = join(SHARED_SRC, f);
    const to = join(SHARED_DEST, f);
    const before = (() => {
      try {
        return readFileSync(to, 'utf8');
      } catch {
        return null;
      }
    })();
    copyFileSync(from, to);
    console.log(`${before === readFileSync(from, 'utf8') ? 'inchangé' : 'copié'} : shared/${f} -> relay/lib/shared/${f}`);
  }
}
