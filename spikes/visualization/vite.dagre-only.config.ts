import { defineConfig } from 'vite';

export default defineConfig({
  root: 'dagre-only',
  base: './',
  build: {
    outDir: '../dist/dagre-only',
    emptyOutDir: true,
  },
});
