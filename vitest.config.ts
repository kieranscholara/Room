import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@roomsell\/catalogue\/assets$/, replacement: resolve('packages/catalogue/src/assets.ts') },
      ...['scene-core', 'geometry', 'layout-engine', 'catalogue'].map((name) => ({
        find: new RegExp(`^@roomsell/${name}$`),
        replacement: resolve(`packages/${name}/src/index.ts`),
      })),
    ],
  },
  test: { include: ['tests/**/*.test.ts'], maxWorkers: 2 },
});
