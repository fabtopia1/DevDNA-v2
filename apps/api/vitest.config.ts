import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * NestJS dependency injection resolves constructor parameters from
 * `design:paramtypes` metadata, which esbuild (vitest's default transform)
 * does not emit. SWC does, so the API test suite is transformed with SWC.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The suite shares one Postgres database; serial execution keeps the
    // tenant-isolation assertions meaningful.
    fileParallelism: false,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
