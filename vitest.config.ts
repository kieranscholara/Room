import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      ['scene-core', 'geometry', 'layout-engine'].map((name) => [
        `@roomsell/${name}`,
        resolve(`packages/${name}/src/index.ts`),
      ]),
    ),
  },
  test: { include: ['tests/**/*.test.ts'], maxWorkers: 2 },
});
