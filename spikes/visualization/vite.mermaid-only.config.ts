import { defineConfig } from 'vite';

export default defineConfig({
  root: 'mermaid-only',
  base: './',
  build: {
    outDir: '../dist/mermaid-only',
    emptyOutDir: true,
  },
});
