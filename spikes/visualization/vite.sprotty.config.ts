import { defineConfig } from 'vite';

export default defineConfig({
  root: 'sprotty',
  base: './',
  build: { outDir: '../dist/sprotty', emptyOutDir: true },
});
