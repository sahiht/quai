import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Les fichiers lancent chacun leur pile de serveurs : en série pour des mesures lisibles.
    fileParallelism: false,
  },
  server: { fs: { allow: ['../..'] } },
});
