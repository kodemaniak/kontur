import { defineConfig } from 'vite';

export default defineConfig({
  root: 'elk-only',
  base: './',
  build: {
    outDir: '../dist/elk-only',
    emptyOutDir: true,
  },
});
