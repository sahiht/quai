import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHARED_DEST, SHARED_FILES, SHARED_SRC } from '../scripts/sync-shared.js';

describe('copie de shared/ dans relay/lib/shared/ (npm run sync-shared)', () => {
  it.each(SHARED_FILES)('%s est identique à ../shared', (file) => {
    const original = readFileSync(join(SHARED_SRC, file));
    const copy = readFileSync(join(SHARED_DEST, file));
    expect(copy.equals(original), `relay/lib/shared/${file} diffère de shared/${file} : lancer npm run sync-shared`).toBe(true);
  });

  it('ne contient que les fichiers recopiés', () => {
    expect(readdirSync(SHARED_DEST).sort()).toEqual([...SHARED_FILES].sort());
  });
});
