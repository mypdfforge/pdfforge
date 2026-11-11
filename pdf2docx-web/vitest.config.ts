import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, './src/core'),
      '@ingest': path.resolve(__dirname, './src/ingest'),
      '@dla': path.resolve(__dirname, './src/dla'),
      '@ast': path.resolve(__dirname, './src/ast'),
      '@emit': path.resolve(__dirname, './src/emit'),
    },
  },
});
