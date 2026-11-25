import { resolve } from 'path';
import { defineConfig } from 'vitest/config';
import lithentVitePlugin from '@lithent/lithent-vite';

export default defineConfig({
  plugins: [lithentVitePlugin()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
