import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec,property.test}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts']
    }
  }
});
